# 贡献指南

感谢参与《雾中列车》的开发。

## 开发流程

1. 从 `main` 创建功能分支，推荐使用 `codex/feature-name` 或 `feature/name`。
2. 修改代码并补充相应测试。
3. 执行以下检查：

```bash
pnpm typecheck
pnpm test
pnpm build
```

涉及界面、实时通信或房间流程时，再运行：

```bash
pnpm exec playwright test
```

4. 提交 Pull Request，并说明行为变化、测试结果和可能的兼容性影响。

## 代码约定

- 使用 TypeScript，避免无必要的 `any`。
- 规则逻辑优先放入服务端游戏引擎，并保持确定性。
- 共享协议放入 `packages/shared`，不要由前端自行复制类型。
- 服务端只能向客户端发送其权限范围内的数据。
- 新增技能、角色或地图时，复用现有注册表和钩子，不要硬编码到界面。
- 数据库结构变化必须提供兼容旧数据的迁移逻辑。

## 测试要求

- 规则变化：增加 Vitest 单元测试。
- 可见性与权限变化：增加投影测试，确认不会泄露隐藏信息。
- 房间、加入、重连、结算变化：增加集成或 Playwright 测试。
- 修复 Bug 时，优先添加能够复现问题的回归测试。

## 提交信息

推荐格式：

```text
feat: add new role
fix: prevent snapshot table growth
docs: update deployment guide
test: cover room switching
```

## 许可证

提交贡献即表示你同意贡献内容按项目的 MIT License 发布。
