#!/bin/bash
# Windows 로그인 시 + 5분마다 실행: Docker/Supabase 켜기, WSL이 꺼지지 않게 유지 (중복 실행 방지)
if pidof systemd >/dev/null 2>&1; then systemctl start docker; else service docker start >/dev/null 2>&1; fi
for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 2; done
cd /opt/nt-supabase && docker compose up -d >/dev/null 2>&1
exec 9>/run/nt-keepalive.lock
flock -n 9 || exit 0          # 이미 유지 프로세스가 있으면 종료
exec sleep infinity
