"""Shared logging configuration for the KMZ GIS Viewer desktop stack."""

from __future__ import annotations

import logging
import os
import sys

_CONFIGURED = False


def configure_logging(force: bool = False) -> None:
    """
    Configure root logging with a stderr stream handler.

    Default level is INFO. Set ``KMZ_LOG_LEVEL=DEBUG`` (or in ``.env``) for verbose output.

    Args:
        force: Re-run handler setup when True.

    Returns:
        None.
    """
    global _CONFIGURED
    if _CONFIGURED and not force:
        return

    level_name = os.environ.get("KMZ_LOG_LEVEL", "INFO").strip().upper()
    level = getattr(logging, level_name, logging.INFO)

    root = logging.getLogger()
    root.setLevel(logging.DEBUG)

    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    has_stream = any(
        isinstance(handler, logging.StreamHandler)
        and getattr(handler, "stream", None) is sys.stderr
        for handler in root.handlers
    )
    if force or not has_stream:
        if force:
            for handler in list(root.handlers):
                if (
                    isinstance(handler, logging.StreamHandler)
                    and getattr(handler, "stream", None) is sys.stderr
                ):
                    root.removeHandler(handler)
        stream_handler = logging.StreamHandler(sys.stderr)
        stream_handler.setLevel(level)
        stream_handler.setFormatter(formatter)
        root.addHandler(stream_handler)

    logging.getLogger("PIL").setLevel(logging.WARNING)
    logging.getLogger("http.client").setLevel(logging.WARNING)

    _CONFIGURED = True
    logging.getLogger(__name__).debug("Logging configured (KMZ_LOG_LEVEL=%s)", level_name)


def get_logger(name: str) -> logging.Logger:
    """
    Return a module logger, configuring logging on first use.

    Args:
        name: Logger name (typically ``__name__``).

    Returns:
        Configured ``logging.Logger`` instance.
    """
    if not _CONFIGURED:
        configure_logging()
    return logging.getLogger(name)
