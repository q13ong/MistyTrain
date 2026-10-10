# 雾中列车

《雾中列车》是一款网页版多人实时盲棋桌游。服务端权威保存真实位置，存活玩家只能看到自己的位置；死亡玩家与观战者可以实时观察完整地图；对局结束后提供排行榜、逐回合轨迹回放和完整事件记录。

当前版本：`1.10.6`

## 功能概览

- 2 至 8 名真人或电脑玩家，最多 32 名观战者。
- 账号注册、登录、房间码加入、分享链接加入和断线重连。
- 八方向移动、挤压死亡、车厢门与喝水倒计时。
- 角色选择、重复角色、技能系统、电脑玩家与多地图扩展接口。
- 服务端权威位置裁剪，存活玩家无法收到对手实时位置。
- 完整行动、事件和服务端快照记录。
- 赛后排行榜和按回合轨迹回放。
- 全局玩家排行榜：平均评分、最高胜率角色、游玩场次和场均 KD。

## 技术栈

- Node.js 24、TypeScript、pnpm workspace
- Fastify、Socket.IO、Zod
- PostgreSQL、Drizzle ORM、PGlite 本地开发数据库
- React 19、Vite、React Router、Zustand、TanStack Query
- Vitest、Playwright

## 本地开发

环境要求：

- Node.js 24
- pnpm 11

```bash
pnpm install
pnpm dev
```

浏览器访问 `http://localhost:5173`。

没有配置 `DATABASE_URL` 时，开发环境使用 PGlite，默认数据目录为 `apps/server/.pglite`。

## 常用命令

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright test
```

Playwright 默认调用系统 Chrome。没有 Chrome 时，可安装 Playwright Chromium，并在 `playwright.config.ts` 中调整 `channel`。

## 环境变量

复制根目录的 [.env.example](.env.example) 并按需修改：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | HTTP 服务端口 | `3000` |
| `HOST` | HTTP 监听地址 | `0.0.0.0` |
| `PUBLIC_ORIGIN` | 浏览器访问的公开地址 | `http://localhost:5173` |
| `SESSION_SECRET` | 会话令牌哈希密钥，生产环境必须修改 | 开发默认值 |
| `DATABASE_URL` | PostgreSQL 连接地址；为空时使用 PGlite | 空 |
| `PGLITE_DATA_DIR` | PGlite 本地数据目录 | `.pglite` |
| `DEFAULT_TURN_TIMEOUT_MS` | 默认行动超时 | `60000` |
| `RECONNECT_GRACE_MS` | 断线重连宽限时间 | `45000` |
| `MAX_SPECTATORS` | 单房间最大观战者数量 | `32` |

生产环境必须配置 `DATABASE_URL`、`SESSION_SECRET` 和正确的 `PUBLIC_ORIGIN`。

## 项目结构

```text
apps/
  server/        Fastify、Socket.IO、规则引擎、房间编排和数据库仓储
  web/           React 前端、游戏界面、排行榜和回放
packages/
  shared/        前后端共享类型、地图和事件协议
deploy/
  tencent/       腾讯云或通用 Docker Compose 部署文件
tests/
  e2e/           Playwright 端到端测试
```

## 部署

单实例部署：

```bash
docker compose --env-file .env up -d --build
```

腾讯云部署说明见 [deploy/tencent/README.md](deploy/tencent/README.md)。

生产架构为一个 Fastify 实例同时提供 REST API、Socket.IO 和前端静态文件，并连接 PostgreSQL。服务启动时只保留每个房间最新的一份快照，避免快照表无限增长。

## 安全模型

- 服务端是规则和位置的唯一权威来源。
- 存活玩家的实时快照只包含自己的位置。
- 死亡玩家和观战者接收完整位置，但所有写操作都会在服务端拒绝。
- WebSocket 命令通过 `commandId` 去重。
- 会话使用 `HttpOnly` Cookie 和服务端哈希令牌。

## 参与贡献

提交代码前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按照 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 Issue 中披露可利用细节。

## 许可证

本项目使用 [MIT License](LICENSE)。
