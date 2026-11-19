@echo off
chcp 65001 >nul
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath \"%~f0\" -Verb RunAs" & exit /b)
title [Edge] .bat 다운로드 경고 원래대로
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v ExemptFileTypeDownloadWarnings /f
echo 완료! Edge를 다시 열면 원래대로 경고가 나옵니다.
pause
