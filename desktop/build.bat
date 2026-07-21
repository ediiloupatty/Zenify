@echo off
cd /d "%~dp0"

echo [1/2] Building zenify-desktop.exe...
call build_exe.bat
if errorlevel 1 ( echo FAILED - pastikan Go, gcc ^(mingw^), dan windres ada di PATH ^(C:\msys64\mingw64\bin^) && pause && exit /b 1 )

REM Build the installer straight after, from the fresh exe. Pass SKIP_EXE_BUILD so
REM Zenify.iss doesn't rebuild the exe a second time (we just built it above).
echo [2/2] Building installer (Output\ZenifySetup.exe)...
set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" ( echo SKIP - Inno Setup tidak ditemukan. Compile Zenify.iss manual di Inno Setup. && goto done )
"%ISCC%" /DSKIP_EXE_BUILD Zenify.iss
if errorlevel 1 ( echo FAILED - Inno compile gagal && pause && exit /b 1 )

:done
echo.
echo Done! zenify-desktop.exe + Output\ZenifySetup.exe siap dibagikan.
pause
