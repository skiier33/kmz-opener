@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Hand off immediately to the hidden VBS launcher (WScript.Shell.Run, window style 0).
rem start returns so this console can close instead of staying open for the GUI lifetime.
start "" wscript //nologo "%~dp0start.vbs"
exit /b 0
