@echo off
chcp 65001 >nul
net session >nul 2>&1 || (powershell -NoProfile -Command "Start-Process -FilePath \"%~f0\" -Verb RunAs" & exit /b)
title [Edge] .bat 다운로드 경고 끄기 (GitHub / Claude 에서 받는 파일만)
echo GitHub / Claude 에서 받는 .bat .cmd .sh .ps1 파일의 다운로드 경고를 끕니다.
echo (다른 사이트 파일은 기존처럼 경고가 나옵니다)
echo.
reg add "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v ExemptFileTypeDownloadWarnings /t REG_SZ /d "[{\"file_extension\":\"bat\",\"domains\":[\"github.com\",\"githubusercontent.com\",\"claude.ai\",\"anthropic.com\"]},{\"file_extension\":\"cmd\",\"domains\":[\"github.com\",\"githubusercontent.com\",\"claude.ai\",\"anthropic.com\"]},{\"file_extension\":\"sh\",\"domains\":[\"github.com\",\"githubusercontent.com\",\"claude.ai\",\"anthropic.com\"]},{\"file_extension\":\"ps1\",\"domains\":[\"github.com\",\"githubusercontent.com\",\"claude.ai\",\"anthropic.com\"]}]" /f
if errorlevel 1 (echo [실패] 관리자 권한으로 다시 실행해 주세요 & pause & exit /b)
echo.
echo 완료! Edge를 모두 닫았다가 다시 열면 적용됩니다.
echo 확인: Edge 주소창에 edge://policy 입력 -^> ExemptFileTypeDownloadWarnings 가 보이면 정상
echo 되돌리기: 14_edge_bat_download_restore.bat 실행
pause
