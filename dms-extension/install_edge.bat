@echo off
chcp 65001 >nul
title NT DMS 확장팩 설치 (Edge)
set DEST=C:\NT-DMS-Ext
if not exist "%DEST%" mkdir "%DEST%"
xcopy /y /q "%~dp0*.js" "%DEST%\" >nul
xcopy /y /q "%~dp0*.json" "%DEST%\" >nul
xcopy /y /q "%~dp0*.html" "%DEST%\" >nul
echo ============================================
echo  확장팩 파일을 C:\NT-DMS-Ext 에 복사했습니다.
echo  곧 Edge 확장 관리 화면이 열립니다.
echo   1) 왼쪽 아래 [개발자 모드] 켜기
echo   2) [압축 풀린 확장 로드] 클릭 -^> C:\NT-DMS-Ext 선택
echo   3) 주소창 오른쪽 퍼즐 아이콘 -^> NT DMS 확장팩 -^> 확장팩 키 입력 후 저장
echo ============================================
start msedge edge://extensions/
pause
