@echo off
chcp 65001 >nul
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath \"%~f0\" -Verb RunAs" & exit /b)
title [서버 항상 켜기] WSL 자동 종료 방지 + 5분 감시
echo [1/4] WSL 자동 종료 끄기 (.wslconfig)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wslconfig.ps1"
echo.
echo [2/4] 유지 스크립트 갱신
wsl -d Ubuntu -u root --cd "%~dp0." -- bash -c "cp ./scripts/keepalive.sh /opt/nt-kit/keepalive.sh && chmod +x /opt/nt-kit/keepalive.sh && echo OK"
echo.
echo [3/4] 5분마다 서버 감시 작업 등록
set VBS=C:\NT-Server-Start.vbs
> "%VBS%" echo CreateObject("Wscript.Shell").Run "wsl.exe -d Ubuntu -u root -- bash /opt/nt-kit/keepalive.sh", 0, False
schtasks /create /f /tn "NT-Supabase-Watchdog" /sc minute /mo 5 /rl highest /tr "wscript.exe \"%VBS%\"" >nul && echo [OK] 5분 감시 등록
echo.
echo [4/4] WSL 재시작 후 서버 켜기 (약 1분, 이 동안 대시보드 잠깐 끊김)
wsl --shutdown
timeout /t 5 >nul
wscript.exe "%VBS%"
timeout /t 60 >nul
wsl -d Ubuntu -u root -- bash -c "cd /opt/nt-supabase && docker compose ps --format 'table {{.Name}}\t{{.Status}}'"
echo.
echo 완료. 위 목록이 모두 Up 이면 정상입니다.
pause
