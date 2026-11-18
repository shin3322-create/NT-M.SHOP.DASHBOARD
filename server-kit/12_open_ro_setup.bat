@echo off
chcp 65001 >nul
title [서버] 인보이스 미종료 RO 저장 창구 추가
set S=open_ro_setup.sh
if exist "%~dp0scripts\open_ro_setup.sh" set S=scripts/open_ro_setup.sh
wsl -d Ubuntu -u root --cd "%~dp0." -- bash %S%
pause
