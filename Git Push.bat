@echo off
setlocal enableDelayedExpansion

REM *** 1. Use the BAT file's save location ***
REM This ensures the Git commands run in the correct project directory, regardless
REM of where the user runs the script from.
cd /d "%~dp0"
set "PROJECT_DIR=%cd%"

echo.
echo ==========================================================
echo Starting Git Setup in: %PROJECT_DIR%
echo ==========================================================
echo.

REM --- 2. Initialize the Repository ---
if not exist .git (
    echo Initializing new Git repository...
    git init
    if errorlevel 1 goto ERROR_GIT
) else (
    echo Git repository already initialized. Skipping 'git init'.
)

echo.
echo --- 3. Stage Files ---
echo Adding all project files to staging area...
REM git add . is the critical fix for the original "nothing added to commit" error.
git add .
if errorlevel 1 goto ERROR_GIT
REM The 'LF will be replaced by CRLF' warnings are harmless and expected on Windows.

echo.
echo --- 4. Commit Files ---
REM Check if there are any changes to commit before trying to commit.
git status --porcelain | findstr /R "." > nul
if errorlevel 1 (
    echo No new changes detected. Skipping 'git commit'.
) else (
    echo Creating the initial commit...
    REM Note: The current branch is likely 'master' at this point.
    git commit -m "First commit"
    if errorlevel 1 goto ERROR_GIT
)

echo.
echo --- 5. Branch Renaming ---
echo Setting branch name to 'main'...
git branch -M main
if errorlevel 1 goto ERROR_GIT

echo.
echo --- 6. Add Remote Origin (Always ask and force clean setup) ---
:ASK_URL
set "REMOTE_URL="
set /p REMOTE_URL="Please enter the GitHub remote URL: "
if "%REMOTE_URL%"=="" (
    echo Error: Remote URL cannot be empty.
    goto ASK_URL
)

REM *** CRITICAL FIX FOR "No such remote 'origin'" ERROR ***
REM Attempt to remove 'origin' first, and suppress the error message (2>nul)
REM if it doesn't exist. This ensures we can safely run 'git remote add' next.
echo Checking for existing remote 'origin' and removing it if found...
git remote remove origin 2>nul

echo Adding remote origin: %REMOTE_URL%
git remote add origin "%REMOTE_URL%"
if errorlevel 1 goto ERROR_GIT

echo.
echo --- 7. Push to GitHub ---
echo Pushing the 'main' branch to the remote repository...
git push -u origin main
if errorlevel 1 (
    echo.
    echo **********************************************************
    echo PUSH FAILED! Common causes:
    echo 1. You need to **authenticate** (watch for a popup window).
    echo 2. You don't have the correct **permissions** to the repository.
    echo 3. The remote repository is **not empty**; if this is the case,
    echo    try running: git pull --rebase
    echo **********************************************************
    goto END
)

echo.
echo ==========================================================
echo Git Initial Setup and Push Completed Successfully!
echo ==========================================================
goto END

:ERROR_GIT
echo.
echo ==========================================================
echo A GIT COMMAND FAILED. Please check the error message above.
echo ==========================================================

:END
endlocal
pause
