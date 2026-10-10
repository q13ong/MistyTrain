#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 root 或 sudo 运行此脚本。"
  exit 1
fi

cd /opt/fog-train/deploy/tencent
docker compose --profile tunnel up -d cloudflared

echo "等待 Cloudflare Tunnel 生成公网地址..."
sleep 12
docker compose logs --no-color cloudflared | tail -n 100
