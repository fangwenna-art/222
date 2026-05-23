# 德州扑克 · H5 + Node.js

一个简化版多人德州扑克项目：Node.js + Express + Socket.IO，前端 H5，服务端控制全部房间与牌局状态。

## 功能

- 创建房间 / 加入房间（最多 9 人）
- 玩家进入、退出、断线重连（`room:resume` + localStorage）
- 服务端广播 `gameState`，前端只渲染状态
- 简化德州扑克流程：`preflop → flop → turn → river → showdown → ended`
- 摊牌节奏：先亮牌停留约 1.8s，再结算进入 `ended`
- 弃牌胜与摊牌结算统一为 `settle` 日志格式（主池 / 边池）
- 标准牌型判断：高牌、一对、两对、三条、顺子、同花、葫芦、四条、同花顺
- 底部固定操作栏（过牌 / 跟注 / 下注 / 加注 / 弃牌 / 全下）
- 局结束：桌心一行摘要 + 延迟展开结果面板（结算明细与亮牌）
- 房间保留最近 10 局摘要（「最近局数」列表）
- 房主可在局间配置起始筹码与小盲 / 大盲（`room:settings`，下一局生效）

## 目录结构

```text
texas-holdem/
├── package.json              # 根入口：npm start / npm test / npm run local
├── dev-local.sh              # 本地一键测试 + 热重载
├── server/
│   ├── package.json
│   └── src/
│       ├── index.js              # Express + Socket.IO + 静态前端托管
│       ├── roomManager.js        # 房间、定时器、摊牌延迟结算
│       ├── gameEngine.js         # 德州扑克引擎
│       ├── handEvaluator.js      # 牌型判断
│       ├── handEvaluator.test.js
│       ├── gameEngine.settlement.test.js
│       └── roomManager.test.js
└── client/
    ├── index.html
    ├── app.js                    # UI、结果面板、桌心摘要
    └── style.css
```

## 本地启动

### 推荐：一体服务（前端 + Socket 同源）

```bash
cd texas-holdem
npm install
npm start
```

默认访问：**http://localhost:3001**

健康检查：

```bash
curl http://localhost:3001/health
```

### 推荐：本地开发（含测试 + 热重载）

```bash
npm run local
```

脚本会依次执行 `npm install` → `npm test` → 启动带 `--watch` 的服务。改 `server/src` 下代码会自动重启。

多人测试：再开一个无痕窗口，加入同一房间号即可。

### 其他端口

```bash
PORT=3010 npm start
```

访问 **http://localhost:3010**（Socket 与页面仍同源）。

### 分离静态页开发（可选）

若用 `5188` / `5173` 跑静态页，Socket 默认连 `3010`：

```bash
# 终端 1
PORT=3010 npm start

# 终端 2（client 目录）
python3 -m http.server 5188
```

## 测试

```bash
npm test
```

包含：

| 命令 | 说明 |
|------|------|
| `npm run test:evaluator` | 牌型判断（高牌 → 同花顺） |
| `npm run test:settlement` | 引擎结算：边池、摊牌节奏、弃牌胜日志 |
| `npm run test:room` | 房间控制：房主、行动超时、摊牌定时器、牌局历史 |

## 结算与 UI 说明

### 牌局阶段

| 阶段 | 桌心 | 结果面板 |
|------|------|----------|
| 进行中 | `轮到 XX` / 阶段名 | 隐藏 |
| `showdown` | `亮牌 · A 一对 · B 高牌` + 倒计时 | 隐藏（只看牌桌亮牌） |
| `ended` | 一行摘要，如 `Alice 获胜 +150 · 一对` | 延迟约 3s 后展开，含结算行与本局明细 |

### 日志格式（结果面板「本局明细」）

摊牌示例：

```text
摊牌 · 开始摊牌
摊牌 · 主池 300 · A +150(一对) · B +150(一对) · 平分
```

弃牌胜示例（与摊牌同为 `settle` 格式）：

```text
局结束 · 主池 50 · Alice +50(对手弃牌)
```

### 开始新一局

- 仅**房主**可点「开始新一局」
- 需要至少 **2 名在线玩家**
- 若卡在摊牌阶段，服务端会自动补结算后再允许开局

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | `3001` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `CLIENT_ORIGIN` | 含 `localhost:3001` 等 | CORS 允许的来源，逗号分隔 |
| `ALLOW_LAN` | `true` | 是否允许局域网 IP 访问 |
| `ACTION_TIMEOUT_MS` | `30000` | 行动超时（自动过牌 / 弃牌） |
| `SHOWDOWN_PAUSE_MS` | `1800` | 摊牌亮牌停留时间（毫秒） |
| `OFFLINE_AUTO_FOLD_MS` | `30000` | 离线自动弃牌 |
| `MAX_HAND_HISTORY` | `10` | 房间内保留的最近局数 |
| `MAX_PLAYERS_PER_ROOM` | `9` | 每房人数上限 |

## 部署到 Railway

1. 把 `texas-holdem` 推到 GitHub
2. 打开 Railway，选择 **New Project → Deploy from GitHub repo**
3. 选择该仓库
4. Railway 会自动执行：

```bash
npm install
npm start
```

5. 生成域名后，直接访问 Railway 的 HTTPS 链接即可

当前项目已经支持平台注入的 `PORT`，不需要额外配置。

## 部署到 Render

1. 把 `texas-holdem` 推到 GitHub
2. Render 新建 **Web Service**
3. Root Directory 选择项目根目录 `texas-holdem`
4. Build Command：

```bash
npm install
```

5. Start Command：

```bash
npm start
```

6. Node 版本建议 18+

## 为什么部署后更稳定

部署后前端和 Socket.IO 使用同一个域名：

```text
https://your-domain.com/
https://your-domain.com/socket.io/
```

这样避免了公网隧道常见的：

- 链接失效
- WebSocket 被断开
- CORS 拦截
- 电脑休眠后服务中断
- 5G 网络访问不稳定

## Socket 事件

| 方向 | 事件 | 说明 |
|------|------|------|
| C→S | `room:create` | 创建房间并加入 |
| C→S | `room:join` | 加入已有房间 |
| C→S | `room:resume` | 断线后恢复身份与状态 |
| C→S | `room:leave` | 离开房间 |
| C→S | `room:settings` | 房主修改 `{ startingChips?, smallBlind?, bigBlind? }`（仅局间） |
| C→S | `game:start` | 开始新一局（房主） |
| C→S | `game:action` | `{ action, amount? }` — fold / check / call / bet / raise / allin |
| S→C | `gameState` | 广播完整状态 |

## 手动指定 Socket 地址

页面 URL 加参数可覆盖自动检测：

```text
http://localhost:3001?server=http://localhost:3001
```
