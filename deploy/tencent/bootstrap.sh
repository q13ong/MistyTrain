#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 root 或 sudo 运行此脚本。"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

systemctl enable docker
systemctl restart docker

mkdir -p /opt/fog-train

if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp || true
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
  ufw allow 443/udp || true
fi

echo "Docker 环境安装完成。"
echo "下一步：将项目上传到 /opt/fog-train，然后在 deploy/tencent 中复制 .env.example 为 .env 并填写配置。"
