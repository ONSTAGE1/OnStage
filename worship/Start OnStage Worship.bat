@echo off
rem OnStage Worship - double-click to start (Windows 10 / 11)
cd /d "%~dp0"
start "OnStage Worship" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\server.ps1"
