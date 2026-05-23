# 可执行规范与状态映射

本目录是项目的**单一事实来源（SSOT）**：牌局阶段、UI 模式、Socket 事件与时序常量。

## 文件

| 文件 | 用途 |
|------|------|
| `phases.json` | 服务端 hand 阶段、gate（canStart / canConfigureRoom / canAct）、转移表 |
| `ui-modes.json` | 客户端 UI 模式与 DOM 行为 flags |
| `timing.json` | 服务端/客户端时序常量（如摊牌 1.8s、结果面板 3s） |
| `socket-events.json` | Socket 事件目录（与 README 同步） |
| `resolveUiMode.mjs` | 纯函数：`resolveUiMode` / `resolveSettingsMode` |
| `loadSpec.mjs` | Node 侧加载 JSON |

## 如何执行

```bash
npm run spec:build   # 生成 client/spec.js
npm run test:spec    # 校验规范与状态映射样例
npm test             # 含 spec:build + test:spec
```

## 代码接入

- **服务端**：`gameEngine.js` 从 `phases.json` 读取 `PHASES` 列表
- **客户端**：`index.html` 加载 `spec.js`（生成物），`app.js` 通过 `window.TexasHoldemSpec` 解析 UI 模式
- **测试**：`server/src/spec.test.js` 断言阶段/模式/时序一致性

修改规范时：先改 JSON → `npm run spec:build` → `npm test`。
