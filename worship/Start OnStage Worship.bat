@echo off
rem OnStage Worship - double-click to start (Windows 10 / 11).
rem Opens the app in its own Microsoft Edge (or Google Chrome) window.
setlocal
cd /d "%~dp0"

if not exist "%~dp0index.html" goto notextracted
if not exist "%~dp0js\app.js" goto notextracted

set "APP=%~dp0index.html"
set "URL=file:///%APP:\=/%"

set "BROWSER="
for %%B in (
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  "%LocalAppData%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do if not defined BROWSER if exist "%%~B" set "BROWSER=%%~B"

if defined BROWSER goto launch
echo.
echo  Microsoft Edge or Google Chrome was not found.
echo  Opening in your default browser instead. For the AI microphone
echo  feature, please install Google Chrome: https://www.google.com/chrome/
echo.
start "" "%APP%"
pause
goto done

:launch
start "" "%BROWSER%" --app="%URL%" --start-maximized

rem Create a desktop shortcut the first time (harmless if it fails).
if exist "%USERPROFILE%\Desktop\OnStage Worship.lnk" goto done
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$d=[Environment]::GetFolderPath('Desktop'); $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'OnStage Worship.lnk')); $s.TargetPath='%~dp0Start OnStage Worship.bat'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0launcher\onstage.ico'; $s.WindowStyle=7; $s.Save()" >nul 2>&1
goto done

:notextracted
echo.
echo  ============================================================
echo   Please EXTRACT the zip file first.
echo.
echo   Right-click "OnStage-Worship.zip" and choose "Extract All...",
echo   then open the extracted folder and double-click
echo   "Start OnStage Worship.bat" again.
echo  ============================================================
echo.
pause

:done
endlocal
