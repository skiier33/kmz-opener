"""Desktop launcher for the KMZ GIS Viewer."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from http.server import ThreadingHTTPServer
from typing import Dict, List, Optional
from urllib.parse import urlencode

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_project_env() -> None:
    """Load KEY=VALUE pairs from ``.env`` in the project root."""
    path = os.path.join(_ROOT, ".env")
    if not os.path.isfile(path):
        return
    try:
        with open(path, encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip()
                if (
                    len(value) >= 2
                    and value[0] == value[-1]
                    and value[0] in ("\"", "'")
                ):
                    value = value[1:-1]
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass


_load_project_env()

if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from desktop.external_edit import (  # noqa: E402
    ExternalEditManager,
    decode_kml_payload,
    editor_command,
    set_editor_command,
    parse_editor_goto,
)
from desktop.geg_appendix_excel import (  # noqa: E402
    build_appendix_from_screenshots,
    default_template_path,
    list_appendix_screenshots_response,
    open_template_workbook,
    resolve_appendix_template_path,
    validate_screenshot_directory,
    validate_template_path,
)
from desktop.icon_to_image import (  # noqa: E402
    preview_icon_to_image as build_icon_to_image_preview,
    save_icon_to_image as write_icon_to_image_outputs,
)
from desktop.coord_table import is_coord_table_path, read_coord_table  # noqa: E402
from desktop.google_earth import launch_google_earth  # noqa: E402
from desktop.copilot_scan_parser import list_scan_parsers  # noqa: E402
from desktop.scan_coordinate_extract import (  # noqa: E402
    parse_scan_coordinates_pdf,
    validate_scan_pdf_path,
    write_scan_coordinates_export,
)
from desktop.log_config import configure_logging, get_logger  # noqa: E402
from desktop.server import (  # noqa: E402
    DESKTOP_TOKEN,
    EXPORT_PATHS,
    STATE_LOCK,
    ensure_user_custom_icons_dir,
    import_custom_icon_from_path,
    normalize_path,
    register_source,
    resolve_session_kmz_paths,
    set_crosshair_icon_window_callback,
    set_scan_gps_window_callback,
    set_sidebar_mode_window_callback,
    set_tool_window_callback,
    start_server,
    user_custom_icons_dir,
)

_EXTERNAL_EDIT = ExternalEditManager()
_VIEWER_BASE_URL: Optional[str] = None
_log = get_logger(__name__)


def _attach_log_if_no_console() -> None:
    """
    Send stdout and stderr to a log file when no console is attached.

    Used for pythonw.exe and the windowed .exe so crashes are not silent.

    Args:
        None.

    Returns:
        None.
    """
    try:
        if sys.stderr is not None and sys.stderr.isatty():
            return
    except OSError:
        pass
    log_dir = os.path.join(
        os.environ.get("LOCALAPPDATA") or os.environ.get("TEMP") or ".",
        "KMZ-GIS-Viewer",
    )
    try:
        os.makedirs(log_dir, exist_ok=True)
        handle = open(
            os.path.join(log_dir, "viewer.log"),
            "a",
            encoding="utf-8",
            buffering=1,
        )
    except OSError:
        return
    sys.stdout = handle
    sys.stderr = handle


def _show_error(message: str) -> None:
    """
    Show a blocking error when no console is available.

    Args:
        message: Text to display to the user.

    Returns:
        None.
    """
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, "KMZ GIS Viewer", 0x10)
        return
    print(message, file=sys.stderr)


def _ensure_webview() -> None:
    """
    Install pywebview with no console window if it is not already importable.

    Args:
        None.

    Returns:
        None.
    """
    if getattr(sys, "frozen", False):
        return
    try:
        import webview  # noqa: F401

        return
    except ImportError:
        pass
    req = os.path.join(_ROOT, "requirements-desktop.txt")
    kwargs: dict = {"capture_output": True, "text": True}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "-r", req],
            **kwargs,
        )
    except (OSError, subprocess.SubprocessError) as err:
        _show_error(f"Could not install desktop dependencies.\n{err}")
        sys.exit(1)
    log_path = os.path.join(
        os.environ.get("TEMP") or os.environ.get("TMP") or ".",
        "kmz_gis_viewer_setup.log",
    )
    try:
        with open(log_path, "w", encoding="utf-8") as handle:
            handle.write(result.stdout or "")
            handle.write(result.stderr or "")
    except OSError:
        pass
    try:
        import webview  # noqa: F401
    except ImportError:
        _show_error(
            "Failed to install desktop dependencies. Details: " + log_path
        )
        sys.exit(1)


if __name__ == "__main__":
    _attach_log_if_no_console()
    configure_logging()
    _ensure_webview()

import webview  # noqa: E402


def app_root() -> str:
    """
    Return the folder that contains index.html.

    Args:
        None.

    Returns:
        Absolute path to the bundled or source web app root.
    """
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return _ROOT


def _open_dialog_flag() -> object:
    """Return the pywebview constant for an open-file dialog."""
    file_dialog = getattr(webview, "FileDialog", None)
    if file_dialog is not None and hasattr(file_dialog, "OPEN"):
        return file_dialog.OPEN
    return webview.OPEN_DIALOG


def _save_dialog_flag() -> object:
    """Return the pywebview constant for a save-file dialog."""
    file_dialog = getattr(webview, "FileDialog", None)
    if file_dialog is not None and hasattr(file_dialog, "SAVE"):
        return file_dialog.SAVE
    return webview.SAVE_DIALOG


def _folder_dialog_flag() -> object:
    """Return the pywebview constant for a folder picker dialog."""
    file_dialog = getattr(webview, "FileDialog", None)
    if file_dialog is not None and hasattr(file_dialog, "FOLDER"):
        return file_dialog.FOLDER
    return getattr(webview, "FOLDER_DIALOG", 3)


def kmz_export_name(file_name: str) -> str:
    """
    Return a .kmz file name derived from the loaded document name.

    Args:
        file_name: Original file name, with or without a directory.

    Returns:
        A basename ending in .kmz.
    """
    base = os.path.basename(str(file_name or "").replace("\\", "/"))
    stem, _ext = os.path.splitext(base)
    if not stem or stem in {".", ".."}:
        stem = "untitled"
    return stem + ".kmz"


def _dialog_directory(initial: Optional[str]) -> str:
    """
    Return a folder path suitable for pywebview dialog ``directory=``.

    Args:
        initial: Preferred starting folder from user settings.

    Returns:
        Normalized path when it exists, otherwise an empty string.
    """
    if not initial or not isinstance(initial, str):
        return ""
    full = normalize_path(initial.strip())
    if os.path.isdir(full):
        return full
    return ""


def _first_path(result: object) -> Optional[str]:
    """Return the first path from a file-dialog result."""
    if isinstance(result, str) and result:
        return result
    if isinstance(result, (list, tuple)) and result:
        return str(result[0])
    return None


def _invoke_on_ui(window: object, action):
    """
    Run a callable on the WinForms UI thread when the window requires it.

    JavaScript API calls run on a background thread. A Windows file dialog
    shown from that thread fails immediately, so the picker never appears.

    Args:
        window: pywebview window that owns the native form.
        action: Callable that performs the UI work.

    Returns:
        The value returned by action.
    """
    native = getattr(window, "native", None)
    invoke = getattr(native, "Invoke", None)
    if invoke is None or not getattr(native, "InvokeRequired", False):
        return action()

    box: Dict[str, object] = {}

    def _run() -> None:
        box["value"] = action()

    from System import Func, Type

    invoke(Func[Type](_run))
    return box.get("value")


def _invoke_on_ui_always(window: object, action):
    """
    Run a callable on the WinForms UI thread whenever Invoke is available.

    Args:
        window: pywebview window that owns the native form.
        action: Callable that performs the UI work.

    Returns:
        The value returned by action.
    """
    native = getattr(window, "native", None)
    invoke = getattr(native, "Invoke", None)
    if invoke is None:
        return action()

    box: Dict[str, object] = {}

    def _run() -> None:
        box["value"] = action()

    from System import Func, Type

    invoke(Func[Type](_run))
    return box.get("value")


def _source_payload(path: str) -> dict:
    """Register a path and return the metadata the page needs to read it."""
    full = normalize_path(path)
    token = register_source(full)
    return {"path": full, "name": os.path.basename(full), "token": token}


class DesktopApi:
    """Native file dialogs and path registration for the desktop window."""

    # Window this API instance belongs to. Set for tool windows so native
    # dialogs open over the window the user clicked in, not the main viewer.
    _owner_window: object = None

    def _dialog_window(self) -> object:
        """Return the window that should own native dialogs, or None."""
        owner = self._owner_window
        if owner is not None and owner in webview.windows:
            return owner
        windows = webview.windows
        return windows[0] if windows else None

    def session_token(self) -> str:
        """
        Return the per-launch secret required by local file endpoints.

        Returns:
            The desktop session token.
        """
        return DESKTOP_TOKEN

    def custom_icons_folder(self) -> str:
        """
        Return the folder where users can drop custom point icon PNG files.

        Returns:
            Absolute path to the user custom-icons directory.
        """
        return user_custom_icons_dir()

    def import_custom_icon(self) -> Optional[dict]:
        """
        Pick a PNG with a native dialog and copy it into the user custom-icons folder.

        Returns:
            Saved icon metadata (name and url), or None if the dialog was cancelled.
        """
        windows = webview.windows
        if not windows:
            return None
        window = windows[0]

        def _pick() -> Optional[str]:
            result = window.create_file_dialog(
                _open_dialog_flag(),
                allow_multiple=False,
                file_types=("PNG images (*.png)", "All files (*.*)"),
            )
            return _first_path(result)

        path = _invoke_on_ui(window, _pick)
        if not path or not isinstance(path, str):
            return None
        return import_custom_icon_from_path(path)

    def choose_csv(self, initial_directory: str = "") -> Optional[dict]:
        """
        Show a native open dialog for a coordinate CSV or Excel file.

        Args:
            initial_directory: Folder to open the dialog in when set.

        Returns:
            Path metadata for the chosen file, or None if cancelled.
        """
        window = self._dialog_window()
        if window is None:
            return None
        start_dir = _dialog_directory(initial_directory)

        def _open() -> Optional[str]:
            result = window.create_file_dialog(
                _open_dialog_flag(),
                directory=start_dir,
                allow_multiple=False,
                file_types=(
                    "CSV or Excel (*.csv;*.xlsx;*.xlsm;*.xls)",
                    "CSV (*.csv)",
                    "Excel (*.xlsx;*.xlsm;*.xls)",
                    "All files (*.*)",
                ),
            )
            return _first_path(result)

        path = _invoke_on_ui(window, _open)
        if not path or not isinstance(path, str):
            return None
        full = normalize_path(path)
        if not is_coord_table_path(full) or not os.path.isfile(full):
            return None
        return {"path": full, "name": os.path.basename(full)}

    def read_coord_file(self, path: str = "") -> dict:
        """
        Read a local CSV or Excel coordinate table for the CSV-to-KMZ tool.

        Args:
            path: Absolute path to a .csv, .xlsx, .xlsm, or .xls file.

        Returns:
            Dict with ``path``, ``format``, and ``text`` (CSV) or ``base64``
            (.xlsx/.xlsm workbook bytes); or ``error`` when it cannot be read.
        """
        result = read_coord_table(path)
        if result.get("error"):
            _log.warning("read_coord_file failed path=%s: %s", path, result["error"])
        return result

    def choose_kmz(self, initial_directory: str = "") -> Optional[dict]:
        """
        Show a native open dialog and register the chosen KMZ or KML.

        Args:
            initial_directory: Folder to open the dialog in when set.

        Returns:
            Path metadata for the chosen file, or None if the dialog was cancelled.
        """
        window = self._dialog_window()
        if window is None:
            return None
        start_dir = _dialog_directory(initial_directory)

        def _open() -> Optional[str]:
            result = window.create_file_dialog(
                _open_dialog_flag(),
                directory=start_dir,
                allow_multiple=False,
                file_types=("KMZ and KML (*.kmz;*.kml)", "All files (*.*)"),
            )
            return _first_path(result)

        path = _invoke_on_ui(window, _open)
        if not path or not isinstance(path, str):
            return None
        return _source_payload(path)

    def choose_directory(self, initial_directory: str = "") -> Optional[dict]:
        """
        Show a native folder picker for screenshot export.

        Args:
            initial_directory: Folder to open the dialog in when set.

        Returns:
            The chosen folder path, or None if the dialog was cancelled.
        """
        window = self._dialog_window()
        if window is None:
            return None
        start_dir = _dialog_directory(initial_directory)

        def _pick() -> Optional[str]:
            result = window.create_file_dialog(
                _folder_dialog_flag(),
                directory=start_dir,
            )
            return _first_path(result)

        path = _invoke_on_ui(window, _pick)
        if not path or not isinstance(path, str):
            return None
        full = normalize_path(path)
        if not os.path.isdir(full):
            return None
        return {"path": full}

    def choose_geg_appendix_template(self, initial_directory: str = "") -> Optional[dict]:
        """
        Show a native open dialog for the GEG appendix Excel template.

        Args:
            initial_directory: Folder to open the dialog in when set.

        Returns:
            Path metadata for the chosen .xlsm, or None if cancelled.
        """
        windows = webview.windows
        if not windows:
            return None
        window = windows[0]
        start_dir = _dialog_directory(initial_directory)

        def _open() -> Optional[str]:
            result = window.create_file_dialog(
                _open_dialog_flag(),
                directory=start_dir,
                allow_multiple=False,
                file_types=(
                    "Excel macro (*.xlsm)",
                    "Excel (*.xls;*.xlsx;*.xlsm)",
                    "All files (*.*)",
                ),
            )
            return _first_path(result)

        path = _invoke_on_ui(window, _open)
        if not path or not isinstance(path, str):
            return None
        full = normalize_path(path)
        if validate_template_path(full):
            return None
        return {"path": full, "name": os.path.basename(full)}

    def open_geg_appendix_template(self, template_path: str = "") -> dict:
        """
        Open the active GEG appendix Excel template for editing in Excel.

        Args:
            template_path: Optional .xlsm template; defaults to bundled GEG file.

        Returns:
            ``ok`` and ``path``, or ``error`` when the template cannot be opened.
        """
        template = normalize_path(template_path) if template_path else default_template_path(app_root())
        launch_err = open_template_workbook(template)
        if launch_err:
            return {"error": launch_err}
        return {"ok": True, "path": template}

    def choose_scan_pdf(self, initial_directory: str = "") -> Optional[dict]:
        """
        Show a native open dialog for a scanned boring-log PDF.

        Args:
            initial_directory: Folder to open the dialog in when set.

        Returns:
            Path metadata for the chosen PDF, or None if cancelled.
        """
        windows = webview.windows
        if not windows:
            return None
        window = windows[0]
        start_dir = _dialog_directory(initial_directory)

        def _open() -> Optional[str]:
            result = window.create_file_dialog(
                _open_dialog_flag(),
                directory=start_dir,
                allow_multiple=False,
                file_types=("PDF (*.pdf)", "All files (*.*)"),
            )
            return _first_path(result)

        path = _invoke_on_ui(window, _open)
        if not path or not isinstance(path, str):
            return None
        full = normalize_path(path)
        if validate_scan_pdf_path(full):
            return None
        return {"path": full, "name": os.path.basename(full)}

    def choose_scan_coords_export_path(
        self, suggested_name: str = "borehole-coordinates.csv", initial_directory: str = ""
    ) -> Optional[dict]:
        """
        Show a native save dialog for coordinate export CSV.

        Args:
            suggested_name: Default file name in the dialog.
            initial_directory: Folder to open the dialog in when set.

        Returns:
            The chosen path, or None if the dialog was cancelled.
        """
        windows = webview.windows
        if not windows:
            return None
        window = windows[0]
        file_name = suggested_name.strip() if isinstance(suggested_name, str) else ""
        if not file_name:
            file_name = "borehole-coordinates.csv"
        if not file_name.lower().endswith(".csv"):
            file_name = f"{file_name}.csv"
        start_dir = _dialog_directory(initial_directory)

        def _save() -> Optional[str]:
            result = window.create_file_dialog(
                _save_dialog_flag(),
                directory=start_dir,
                save_filename=file_name,
                file_types=("CSV (*.csv)", "All files (*.*)"),
            )
            return _first_path(result)

        path = _invoke_on_ui(window, _save)
        if not path or not isinstance(path, str):
            return None
        full = normalize_path(path)
        stem, ext = os.path.splitext(full)
        if ext.lower() != ".csv":
            full = f"{stem}.csv" if stem else f"{full}.csv"
        with STATE_LOCK:
            EXPORT_PATHS.add(full)
        return {"path": full, "name": os.path.basename(full)}

    def scan_parser_options(self) -> dict:
        """
        Return available scan parsing engines for the Parse GPS tool UI.

        Returns:
            Dict with ``parsers`` list (id, label, available).
        """
        parsers = list_scan_parsers()
        _log.debug("scan_parser_options: %s", parsers)
        return {"parsers": parsers}

    def parse_scan_coordinates_pdf(self, pdf_path: str = "", parser: str = "ocr") -> dict:
        """
        Parse Boring ID and GPS N/W from each page of a scanned boring-log PDF.

        Args:
            pdf_path: Absolute path to the PDF file.
            parser: ``ocr`` or ``copilot``.

        Returns:
            Parsed pages with thumbnails, or ``error`` on failure.
        """
        path = normalize_path(pdf_path) if pdf_path else ""
        mode = parser.strip().lower() if isinstance(parser, str) else "ocr"
        _log.info("parse_scan_coordinates_pdf parser=%s path=%s", mode, path or "(empty)")
        result = parse_scan_coordinates_pdf(path, parser=mode)
        if isinstance(result, dict) and result.get("error"):
            _log.warning("parse_scan_coordinates_pdf failed: %s", result.get("error"))
        elif isinstance(result, dict):
            _log.info(
                "parse_scan_coordinates_pdf ok pages=%s",
                result.get("pageCount", "?"),
            )
        return result

    def write_scan_coordinates_export(
        self, export_path: str, rows: object
    ) -> dict:
        """
        Write tab-separated borehole coordinates to a text file.

        Args:
            export_path: Destination file path.
            rows: List of dicts with boringId, latitudeN, longitudeW.

        Returns:
            Result dict with path and lineCount, or ``error``.
        """
        if not export_path or not isinstance(export_path, str):
            return {"error": "Choose an output file."}
        if not isinstance(rows, list):
            return {"error": "No rows to export."}
        full = normalize_path(export_path)
        _log.info("write_scan_coordinates_export path=%s rows=%s", full, len(rows))
        result = write_scan_coordinates_export(full, rows)
        if "error" in result:
            _log.warning("write_scan_coordinates_export failed: %s", result.get("error"))
            return result
        _log.info(
            "write_scan_coordinates_export ok lineCount=%s",
            result.get("lineCount", "?"),
        )
        with STATE_LOCK:
            EXPORT_PATHS.add(full)
        return result

    def choose_export_path(
        self, suggested_name: str, initial_directory: str = ""
    ) -> Optional[dict]:
        """
        Show a native save dialog for exporting the map as a KMZ file.

        Args:
            suggested_name: Default file name shown in the dialog.
            initial_directory: Folder to open the dialog in when set.

        Returns:
            The chosen path, or None if the dialog was cancelled.
        """
        windows = webview.windows
        if not windows:
            return None
        window = windows[0]
        file_name = kmz_export_name(suggested_name)
        start_dir = _dialog_directory(initial_directory)

        def _save() -> Optional[str]:
            result = window.create_file_dialog(
                _save_dialog_flag(),
                directory=start_dir,
                save_filename=file_name,
                file_types=("KMZ (*.kmz)",),
            )
            return _first_path(result)

        path = _invoke_on_ui(window, _save)
        if not path or not isinstance(path, str):
            return None
        full = normalize_path(path)
        stem, ext = os.path.splitext(full)
        if ext.lower() != ".kmz":
            full = f"{stem}.kmz" if ext else f"{full}.kmz"
        with STATE_LOCK:
            EXPORT_PATHS.add(full)
        return {"path": full, "name": os.path.basename(full)}

    def register_path(self, path: str) -> Optional[dict]:
        """
        Register an existing KMZ or KML so the page can read and copy it.

        Args:
            path: Absolute path previously opened on this machine.

        Returns:
            Path metadata, or None when the file cannot be used.
        """
        if not path or not isinstance(path, str):
            return None
        try:
            return _source_payload(path)
        except OSError:
            return None

    def external_editor_settings(self) -> dict:
        """
        Return the configured external KML editor command.

        Returns:
            Dict with ``command`` and whether Sublime would be used by default.
        """
        cmd = editor_command()
        return {
            "command": cmd,
            "hasCustomCommand": bool(cmd),
        }

    def set_external_editor(self, command: str) -> dict:
        """
        Persist the command used to launch an external text editor.

        Args:
            command: Executable path or full command line; empty clears it.

        Returns:
            Updated settings dict from ``external_editor_settings``.
        """
        if command is None or not isinstance(command, str):
            command = ""
        set_editor_command(command.strip())
        return self.external_editor_settings()

    def choose_external_editor(self) -> Optional[dict]:
        """
        Pick an editor executable with a native open dialog.

        Returns:
            Updated settings after storing the chosen path, or None if cancelled.
        """
        windows = webview.windows
        if not windows:
            return None
        window = windows[0]

        def _pick() -> Optional[str]:
            result = window.create_file_dialog(
                _open_dialog_flag(),
                allow_multiple=False,
                file_types=("Programs (*.exe)", "All files (*.*)"),
            )
            return _first_path(result)

        path = _invoke_on_ui(window, _pick)
        if not path or not isinstance(path, str):
            return None
        set_editor_command(normalize_path(path))
        return self.external_editor_settings()

    def begin_external_kml_edit(
        self,
        source_path: str,
        kml_inner_path: str,
        kml_b64: str,
        goto_start_line: int = 0,
        goto_start_column: int = 0,
        goto_end_line: int = 0,
        goto_end_column: int = 0,
    ) -> Optional[dict]:
        """
        Open the document KML in an external editor and watch for saves.

        Args:
            source_path: Absolute path to the opened KMZ or KML file.
            kml_inner_path: KML path inside a KMZ, or empty for .kml files.
            kml_b64: Base64-encoded UTF-8 KML currently shown in the viewer.
            goto_start_line: Optional 1-based start line to reveal in the editor.
            goto_start_column: Optional 1-based start column to reveal.
            goto_end_line: Optional 1-based end line for selection highlight.
            goto_end_column: Optional 1-based end column for selection highlight.

        Returns:
            Session metadata, or None when editing cannot start.
        """
        if not source_path or not isinstance(source_path, str):
            return None
        if kml_b64 is None or not isinstance(kml_b64, str) or not kml_b64:
            return None
        try:
            payload = decode_kml_payload(kml_b64)
        except ValueError:
            return None
        inner = kml_inner_path if isinstance(kml_inner_path, str) else ""
        goto = parse_editor_goto(
            goto_start_line,
            goto_start_column,
            goto_end_line,
            goto_end_column,
        )
        try:
            return _EXTERNAL_EDIT.begin(source_path, inner, payload, goto)
        except (OSError, ValueError):
            return None

    def stop_external_kml_edit(self, session_id: str) -> None:
        """
        Stop watching an external edit session.

        Args:
            session_id: Value returned from ``begin_external_kml_edit``.

        Returns:
            None.
        """
        if session_id and isinstance(session_id, str):
            _EXTERNAL_EDIT.stop_session(session_id)

    def open_google_earth(self, paths: object) -> dict:
        """
        Launch Google Earth with KMZ or KML files from this session.

        Args:
            paths: List of absolute paths already opened in the viewer.

        Returns:
            Result dict with ``ok`` and ``count``, or ``error`` when launch fails.
        """
        try:
            allowed = resolve_session_kmz_paths(paths)
        except ValueError as err:
            return {"error": str(err)}
        try:
            launch_google_earth(allowed)
        except FileNotFoundError as err:
            return {"error": str(err)}
        except OSError as err:
            return {"error": err.strerror or "Could not start Google Earth."}
        return {"ok": True, "count": len(allowed)}

    def geg_appendix_template_path(self) -> dict:
        """
        Return the bundled GEG Excel template used for appendix PDF export.

        Returns:
            Dict with absolute ``path`` to the template .xlsm.
        """
        path = default_template_path(app_root())
        return {"path": path}

    def list_appendix_screenshots(
        self,
        screenshot_directory: str = "",
        template_path: str = "",
        sheet_preview_limit: int = 10,
        include_thumbnails: bool = True,
    ) -> dict:
        """
        List PNG screenshots available for appendix PDF compilation.

        Args:
            screenshot_directory: Folder to scan; must exist when non-empty.
            template_path: Optional .xlsm template; defaults to bundled GEG file.
            sheet_preview_limit: Maximum sheet cards returned to the UI.
            include_thumbnails: When False, skip JPEG thumbnails for a faster scan.

        Returns:
            Preview dict or ``error`` when the folder is invalid.
        """
        directory = normalize_path(screenshot_directory) if screenshot_directory else ""
        template = normalize_path(template_path) if template_path else ""
        return list_appendix_screenshots_response(
            directory,
            template,
            app_root(),
            sheet_preview_limit=sheet_preview_limit,
            include_thumbnails=include_thumbnails,
        )

    def preview_icon_to_image(
        self,
        screenshot_directory: str = "",
        icon_png_b64: str = "",
        icon_size_px: int = 32,
    ) -> dict:
        """
        Preview compositing an icon onto screenshots using embedded placemark pixels.

        Args:
            screenshot_directory: Folder containing screenshot PNG files.
            icon_png_b64: Base64-encoded icon PNG raster from the viewer.
            icon_size_px: Icon edge length in image pixels.

        Returns:
            Preview dict with sheet thumbnails, or ``error`` on failure.
        """
        try:
            return build_icon_to_image_preview(
                screenshot_directory,
                icon_png_b64,
                icon_size_px,
            )
        except ValueError as val_err:
            return {"error": str(val_err)}
        except OSError as os_err:
            return {"error": str(os_err)}

    def save_icon_to_image(
        self,
        screenshot_directory: str = "",
        icon_png_b64: str = "",
        icon_size_px: int = 32,
    ) -> dict:
        """
        Save icon-composited copies of folder PNGs into ``ss_w_icon``.

        Args:
            screenshot_directory: Folder containing screenshot PNG files.
            icon_png_b64: Base64-encoded icon PNG raster from the viewer.
            icon_size_px: Icon edge length in image pixels.

        Returns:
            Result dict with output paths and counts, or ``error`` on failure.
        """
        try:
            return write_icon_to_image_outputs(
                screenshot_directory,
                icon_png_b64,
                icon_size_px,
            )
        except ValueError as val_err:
            return {"error": str(val_err)}
        except OSError as os_err:
            return {"error": str(os_err)}

    def build_geg_appendix_pdf(
        self,
        screenshot_directory: str = "",
        template_path: str = "",
        title_block: Optional[dict] = None,
    ) -> dict:
        """
        Build a GEG boring-location appendix PDF from PNGs via Excel macros.

        Args:
            screenshot_directory: Folder containing screenshot PNG files.
            template_path: Optional .xlsm template; defaults to bundled GEG file.
            title_block: Optional title block values (projectNo, drawn, drawnBy,
                checkedBy, fileName, largeTitle). Blank values keep the template.

        Returns:
            Result paths and counts, or ``error`` on failure.
        """
        directory = normalize_path(screenshot_directory) if screenshot_directory else ""
        err = validate_screenshot_directory(directory)
        if err:
            return {"error": err}
        template, template_err, template_note = resolve_appendix_template_path(
            normalize_path(template_path) if template_path else "",
            app_root(),
        )
        if template_err:
            return {"error": template_err}

        windows = webview.windows
        if not windows:
            return {"error": "Desktop window is not available."}
        window = windows[0]

        def _build() -> dict:
            try:
                result = build_appendix_from_screenshots(
                    directory,
                    template_path=template,
                    title_block=title_block if isinstance(title_block, dict) else None,
                )
                if template_note and isinstance(result, dict) and "error" not in result:
                    result["templateNote"] = template_note
                return result
            except ValueError as val_err:
                return {"error": str(val_err)}
            except OSError as os_err:
                return {"error": str(os_err)}

        result = _invoke_on_ui(window, _build)
        if not isinstance(result, dict):
            return {"error": "Appendix build did not return a result."}
        if "error" in result:
            return result
        pdf_path = result.get("pdfPath")
        xlsm_path = result.get("xlsmPath")
        if pdf_path:
            with STATE_LOCK:
                EXPORT_PATHS.add(normalize_path(str(pdf_path)))
        if xlsm_path:
            with STATE_LOCK:
                EXPORT_PATHS.add(normalize_path(str(xlsm_path)))
        return result

    def open_scan_gps_window(self) -> dict:
        """
        Open a dedicated window for parsing GPS coordinates from scanned boring logs.

        Returns:
            Dict with ``ok`` when a window was created, or ``error`` when unavailable.
        """
        if not _VIEWER_BASE_URL:
            return {"error": "Desktop window is not available."}
        windows = webview.windows
        if not windows:
            return {"error": "Desktop window is not available."}
        window = windows[0]
        url = f"{_VIEWER_BASE_URL}scan-coordinates.html"
        _log.info("open_scan_gps_window url=%s", url)

        def _open() -> dict:
            try:
                webview.create_window(
                    "Parse GPS from Scan",
                    url,
                    width=920,
                    height=780,
                    min_size=(640, 520),
                    js_api=DesktopApi(),
                )
            except (OSError, RuntimeError, TypeError, ValueError) as err:
                return {"error": f"Could not open window: {err}"}
            return {"ok": True}

        result = _invoke_on_ui_always(window, _open)
        if isinstance(result, dict):
            return result
        return {"ok": True}

    def open_crosshair_icon_window(self) -> dict:
        """
        Open a dedicated window for generating custom crosshair PNG icons.

        Returns:
            Dict with ``ok`` when a window was created, or ``error`` when unavailable.
        """
        if not _VIEWER_BASE_URL:
            return {"error": "Desktop window is not available."}
        windows = webview.windows
        if not windows:
            return {"error": "Desktop window is not available."}
        window = windows[0]
        url = f"{_VIEWER_BASE_URL}crosshair-icon.html"
        _log.info("open_crosshair_icon_window url=%s", url)

        def _open() -> dict:
            try:
                webview.create_window(
                    "Crosshair icon generator",
                    url,
                    width=720,
                    height=640,
                    min_size=(520, 480),
                    js_api=DesktopApi(),
                )
            except (OSError, RuntimeError, TypeError, ValueError) as err:
                return {"error": f"Could not open window: {err}"}
            return {"ok": True}

        result = _invoke_on_ui_always(window, _open)
        if isinstance(result, dict):
            return result
        return {"ok": True}

    def open_tool_window(self, tool: str) -> dict:
        """
        Open a Tools-menu feature in its own window.

        Args:
            tool: Tool id (csv-coords, point-chain, or kml-editor).

        Returns:
            Dict with ``ok`` when a window was created, or ``error`` when unavailable.
        """
        specs = {
            "csv-coords": ("CSV Coordinates to KMZ File", 780, 840),
            "point-chain": ("Point chain", 520, 780),
            "kml-editor": ("KML editor", 560, 520),
        }
        spec = specs.get(str(tool or "").strip())
        if spec is None or not _VIEWER_BASE_URL:
            return {"error": "That tool window is not available."}
        windows = webview.windows
        if not windows:
            return {"error": "Desktop window is not available."}
        window = windows[0]
        title, width, height = spec
        url = f"{_VIEWER_BASE_URL}tool-window.html?tool={tool}"
        _log.info("open_tool_window tool=%s url=%s", tool, url)

        def _open() -> dict:
            api = DesktopApi()
            try:
                api._owner_window = webview.create_window(
                    title,
                    url,
                    width=width,
                    height=height,
                    min_size=(420, 360),
                    js_api=api,
                )
            except (OSError, RuntimeError, TypeError, ValueError) as err:
                return {"error": f"Could not open window: {err}"}
            return {"ok": True}

        result = _invoke_on_ui_always(window, _open)
        if isinstance(result, dict):
            return result
        return {"ok": True}

    def open_sidebar_mode_window(self, mode: str) -> dict:
        """
        Open a sidebar mode tab in its own viewer window.

        Args:
            mode: Sidebar mode (map, icon, or appx).

        Returns:
            Dict with ``ok`` when a window was created, or ``error`` when unavailable.
        """
        specs = {
            "map": ("KMZ GIS Viewer — Map", 1280, 820),
            "icon": ("Icon to Image", 920, 860),
            "appx": ("Appx PDF", 920, 860),
        }
        key = str(mode or "").strip()
        spec = specs.get(key)
        if spec is None or not _VIEWER_BASE_URL:
            return {"error": "That sidebar window is not available."}
        windows = webview.windows
        if not windows:
            return {"error": "Desktop window is not available."}
        window = windows[0]
        title, width, height = spec
        url = f"{_VIEWER_BASE_URL}?popout={key}"
        _log.info("open_sidebar_mode_window mode=%s url=%s", key, url)

        def _open() -> dict:
            try:
                webview.create_window(
                    title,
                    url,
                    width=width,
                    height=height,
                    min_size=(640, 480),
                    js_api=DesktopApi(),
                )
            except (OSError, RuntimeError, TypeError, ValueError) as err:
                return {"error": f"Could not open window: {err}"}
            return {"ok": True}

        result = _invoke_on_ui_always(window, _open)
        if isinstance(result, dict):
            return result
        return {"ok": True}

    def tool_dispatch(self, action: str, payload: object) -> object:
        """
        Run a tool-window command in the main viewer window.

        Args:
            action: KmzToolHost action name.
            payload: JSON-compatible object passed to the viewer.

        Returns:
            Result object from the viewer, or an error dict.
        """
        if not isinstance(action, str) or re.fullmatch(r"[a-zA-Z0-9_-]+", action) is None:
            _log.warning("tool_dispatch rejected invalid action: %r", action)
            return {"error": "Invalid tool action."}
        if not isinstance(payload, dict):
            payload = {}
        tool_id = str(payload.get("tool") or "")
        _log.info("tool_dispatch action=%s tool=%s", action, tool_id or "(none)")
        _log.debug("tool_dispatch payload keys=%s", sorted(payload.keys()))
        viewer = None
        for candidate in webview.windows:
            title = str(getattr(candidate, "title", "") or "")
            if title.startswith("KMZ GIS Viewer"):
                viewer = candidate
                break
        if viewer is None:
            _log.warning("tool_dispatch: main viewer window not found")
            return {"error": "The main viewer window is not open."}
        script = (
            "(function(){try{return window.KmzToolHost&&window.KmzToolHost.dispatch("
            + json.dumps(action)
            + ","
            + json.dumps(payload)
            + ");}catch(err){return {error:(err&&err.message)||String(err)};}})()"
        )
        evaluate = getattr(viewer, "evaluate_js", None)
        if evaluate is None:
            return {"error": "The viewer cannot run tool commands."}
        try:
            result = evaluate(script)
        except (OSError, RuntimeError, TypeError, ValueError) as err:
            _log.error("tool_dispatch evaluate_js failed: %s", err)
            return {"error": str(err)}
        if isinstance(result, str):
            try:
                parsed = json.loads(result)
            except json.JSONDecodeError:
                _log.debug("tool_dispatch returned raw HTML string")
                return {"html": result}
            if isinstance(parsed, dict):
                if parsed.get("error"):
                    _log.warning("tool_dispatch viewer error: %s", parsed.get("error"))
                else:
                    _log.debug("tool_dispatch ok (json string)")
                return parsed
        if isinstance(result, dict):
            if result.get("error"):
                _log.warning("tool_dispatch viewer error: %s", result.get("error"))
            else:
                _log.debug("tool_dispatch ok")
            return result
        _log.warning("tool_dispatch unexpected result type: %s", type(result).__name__)
        return {"error": "The tool did not return a result."}

    def duplicate_window(
        self,
        source_paths: object,
        lat: float,
        lng: float,
        zoom: float,
        basemap: str = "",
    ) -> bool:
        """
        Open another viewer window with the same on-disk KMZ or KML files.

        Args:
            source_paths: List of absolute paths already opened in this session.
            lat: Map center latitude (WGS84) for the new window.
            lng: Map center longitude (WGS84) for the new window.
            zoom: Leaflet zoom level for the new window.
            basemap: Basemap key (osm, satellite, topo) or empty for default.

        Returns:
            True when a new window was created.
        """
        if not _VIEWER_BASE_URL or not isinstance(source_paths, list) or not source_paths:
            return False
        paths: List[str] = []
        for item in source_paths:
            if not item or not isinstance(item, str):
                continue
            try:
                full = normalize_path(item)
            except (TypeError, ValueError):
                continue
            if full not in paths:
                paths.append(full)
        if not paths:
            return False
        try:
            lat_f = float(lat)
            lng_f = float(lng)
            zoom_f = float(zoom)
        except (TypeError, ValueError):
            return False
        query_pairs: List[tuple] = [
            ("lat", f"{lat_f:.8f}"),
            ("lng", f"{lng_f:.8f}"),
            ("z", f"{zoom_f:.4f}"),
        ]
        bm = basemap.strip() if isinstance(basemap, str) else ""
        if bm in {"osm", "satellite", "topo"}:
            query_pairs.append(("bm", bm))
        title_name = "KMZ GIS Viewer"
        for path in paths:
            try:
                meta = _source_payload(path)
            except OSError:
                continue
            query_pairs.append(("f", meta["token"]))
            query_pairs.append(("p", meta["path"]))
            query_pairs.append(("n", meta["name"]))
            if title_name == "KMZ GIS Viewer":
                title_name = f"KMZ GIS Viewer — {meta['name']}"
        if not any(key == "f" for key, _ in query_pairs):
            return False
        url = _VIEWER_BASE_URL + "?" + urlencode(query_pairs)
        webview.create_window(
            title_name,
            url,
            width=1280,
            height=820,
            min_size=(900, 600),
            js_api=DesktopApi(),
        )
        return True


def _notify_external_kml_saved() -> None:
    """Ask every viewer window to reload after an external save."""
    script = "window.kmzExternalKmlSaved && window.kmzExternalKmlSaved();"
    for window in webview.windows:
        evaluate = getattr(window, "evaluate_js", None)
        if evaluate is not None:
            evaluate(script)


def main() -> None:
    """Open the KMZ GIS Viewer in a native window."""
    global _VIEWER_BASE_URL
    configure_logging()
    _log.info("Starting KMZ GIS Viewer desktop app")
    server: Optional[ThreadingHTTPServer] = None
    try:
        ensure_user_custom_icons_dir()
        server, port = start_server(app_root())
        _VIEWER_BASE_URL = f"http://127.0.0.1:{port}/"
        set_scan_gps_window_callback(lambda: DesktopApi().open_scan_gps_window())
        set_crosshair_icon_window_callback(lambda: DesktopApi().open_crosshair_icon_window())
        set_tool_window_callback(lambda tool: DesktopApi().open_tool_window(tool))
        set_sidebar_mode_window_callback(
            lambda mode: DesktopApi().open_sidebar_mode_window(mode)
        )
        webview.create_window(
            "KMZ GIS Viewer",
            f"http://127.0.0.1:{port}/",
            width=1280,
            height=820,
            min_size=(900, 600),
            js_api=DesktopApi(),
        )
        _EXTERNAL_EDIT.set_notify(_notify_external_kml_saved)
        webview.start()
    finally:
        _EXTERNAL_EDIT.set_notify(None)
        _EXTERNAL_EDIT.stop_all()
        if server is not None:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
