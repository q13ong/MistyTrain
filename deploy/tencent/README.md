# 腾讯云轻量应用服务器部署

推荐购买配置：

- 厂商：腾讯云轻量应用服务器
- 地域：中国香港
- 镜像：Ubuntu 24.04 LTS
- 配置：2 核 CPU、2GB 内存、40GB 以上系统盘
- 带宽：建议 5Mbps 或更高
- 防火墙：开放 TCP 22、80、443，以及 UDP 443

## 为什么选香港节点

香港节点不需要大陆 ICP 备案，部署完成后即可通过 HTTPS 域名访问；相比 Render、Railway 等海外 PaaS，对大陆用户的连接通常更稳定。服务规模扩大后，再迁移到腾讯云大陆节点并办理域名备案即可。

## 公网 HTTPS

在中国大陆地域的服务器上，没有备案域名时腾讯云可能拦截 80/443 的网页访问。此时可以执行：

```bash
sudo bash enable-cloudflare-tunnel.sh
```

脚本会启动 Cloudflare Quick Tunnel，直接输出一个可公网访问的 `https://*.trycloudflare.com` 地址。该地址支持 WebSocket；服务器重启后地址可能变化，正式长期使用建议绑定域名并使用 Cloudflare Named Tunnel。

使用 Quick Tunnel 时，需要将 `deploy/tencent/.env` 中的 `PUBLIC_ORIGIN` 更新为当前隧道地址，再重启 App 容器：

```bash
sudo docker compose up -d app
```

## 一条命令部署

在仓库根目录执行：

```powershell
.\deploy\tencent\deploy.ps1 `
  -Server "1.2.3.4" `
  -IdentityFile "C:\path\to\key.pem" `
  -PublicOrigin "https://your-public-origin.example" `
  -SessionSecret "至少32位随机字符串" `
  -DatabasePassword "数据库强密码"
```

如果使用腾讯云控制台生成的 root 密码登录，可省略 `IdentityFile`，命令会提示输入密码。

部署完成后访问 `PUBLIC_ORIGIN`。Fastify、Socket.IO 和 PostgreSQL 都由 Docker Compose 在云服务器上运行；HTTPS 由 Cloudflare Tunnel 或服务器前方的反向代理终止。

## 后续换正式域名

购买域名并在 DNS 中添加 A 记录指向服务器公网 IP，然后修改服务器上的 `deploy/tencent/.env`：

```bash
PUBLIC_ORIGIN=https://train.example.com
```

重新启动：

```bash
cd /opt/fog-train/deploy/tencent
sudo docker compose up -d
```
