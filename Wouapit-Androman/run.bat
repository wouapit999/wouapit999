@echo off
REM Launch Wouapit-Androman on Windows without installing anything.
REM   run.bat            opens the graphical app
REM   run.bat transfer   switch the connected phone to File Transfer (MTP)
REM   run.bat status     show the current USB mode
cd /d "%~dp0"
if "%PYTHON%"=="" set PYTHON=python
"%PYTHON%" -m wouapit_androman %*
