' Hidden launcher for KMZ GIS Viewer.
' Finds pythonw and starts the GUI with a normal window. Dependency install is
' done inside app.py with CREATE_NO_WINDOW so a hidden cmd.exe cannot hide the
' WebView or misreport pip's exit code.
Option Explicit

Const WINDOW_NORMAL = 1
Const ICON_ERROR = 16

Dim shell, fso, root, pythonwExe, appCmd, exitCode

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root

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
  shell.Run "cmd /c where " & name & " > " & Quote(tmp) & " 2>&1", 0, True
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

pythonwExe = Which("pythonw")
If pythonwExe = "" Then pythonwExe = Which("python")
If pythonwExe = "" Then pythonwExe = Which("pyw")
If pythonwExe = "" Then pythonwExe = Which("py")
If pythonwExe = "" Then
  Fail "Python 3 is required. Install it from https://www.python.org/downloads/ and add it to PATH."
End If

appCmd = Quote(pythonwExe) & " " & Quote(root & "\desktop\app.py")
exitCode = shell.Run(appCmd, WINDOW_NORMAL, False)
If exitCode <> 0 Then
  Fail "Could not start KMZ GIS Viewer."
End If
