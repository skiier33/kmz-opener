' Hidden launcher for KMZ GIS Viewer.
' Pip runs with window style 0 (no console). The GUI is started with pythonw via
' `start`, so the WebView is visible — Run(..., 0) would hide that window.
Option Explicit

Const WINDOW_HIDDEN = 0
Const ICON_ERROR = 16

Dim shell, fso, root, logFile, pipCmd, appCmd, pythonExe, pythonwExe, exitCode

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
logFile = shell.ExpandEnvironmentStrings("%TEMP%\kmz_gis_viewer_setup.log")

Sub Fail(message)
  MsgBox message, ICON_ERROR, "KMZ GIS Viewer"
  WScript.Quit 1
End Sub

Function Quote(path)
  Quote = """" & path & """"
End Function

Function Which(name)
  Dim tmp, stream, line, first, preferred
  tmp = shell.ExpandEnvironmentStrings("%TEMP%\kmz_which_" & name & ".txt")
  shell.Run "cmd /c where " & name & " > " & Quote(tmp) & " 2>&1", WINDOW_HIDDEN, True
  Which = ""
  first = ""
  preferred = ""
  If Not fso.FileExists(tmp) Then Exit Function
  Set stream = fso.OpenTextFile(tmp, 1)
  Do Until stream.AtEndOfStream
    line = Trim(stream.ReadLine)
    If line <> "" Then
      If first = "" Then first = line
      If InStr(1, line, "WindowsApps", vbTextCompare) = 0 Then
        preferred = line
        Exit Do
      End If
    End If
  Loop
  stream.Close
  If preferred <> "" Then
    Which = preferred
  Else
    Which = first
  End If
End Function

pythonExe = Which("python")
pythonwExe = Which("pythonw")
If pythonExe = "" Then pythonExe = Which("py")
If pythonwExe = "" Then pythonwExe = Which("pyw")
If pythonExe = "" Then
  Fail "Python 3 is required. Install it from https://www.python.org/downloads/ and add it to PATH."
End If
If pythonwExe = "" Then pythonwExe = pythonExe

pipCmd = "cmd /c " & Quote(pythonExe) & " -m pip install -r " & Quote(root & "\requirements-desktop.txt") _
  & " > " & Quote(logFile) & " 2>&1"
exitCode = shell.Run(pipCmd, WINDOW_HIDDEN, True)
If exitCode <> 0 Then
  Fail "Failed to install desktop dependencies. Details: " & logFile
End If

' Hide the helper cmd; `start` creates a detached pythonw process with a normal window.
appCmd = "cmd /c start """" /D " & Quote(root) & " " & Quote(pythonwExe) & " " _
  & Quote(root & "\desktop\app.py")
exitCode = shell.Run(appCmd, WINDOW_HIDDEN, True)
If exitCode <> 0 Then
  Fail "Could not start KMZ GIS Viewer."
End If
