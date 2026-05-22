# 德州扑克 · H5 + Node.js

一个简化版多人德州扑克项目：Node.js + Express + Socket.IO，前端 H5，服务端控制全部房间与牌局状态。

## 功能

- 创建房间 / 加入房间
- 玩家进入、退出、断线重连
- 服务端广播 `gameState`
- 简化德州扑克流程：`preflop → flop → turn → river → showdown`
- 每人 2 张手牌，5 张公共牌
- 支持 `fold / call / raise`
- 标准牌型判断：高牌、一对、两对、三条、顺子、同花、葫芦、四条、同花顺
- 前端只渲染状态，不保存游戏逻辑

## 目录结构

```text
texas-holdem/
├── package.json              # 部署入口：npm start
├── server/
│   ├── package.json
│   ├── package-lock.json
│   └── src/
│       ├── index.js          # Express + Socket.IO + 静态前端托管
│       ├── gameEngine.js     # 简化德州扑克引擎
│       ├── handEvaluator.js  # 标准牌型判断
│       └── handEvaluator.test.js
└── client/
    ├── index.html
    ├── app.js
    └── style.css
```

## 本地启动

推荐从根目录启动，前端和后端会由同一个 Node 服务提供：

```bash
cd texas-holdem
npm install
npm start
```

默认访问：

```text
http://localhost:3001
```

如果你想使用之前的本地端口：

```bash
PORT=3010 npm start
```

访问：

```text
http://localhost:3010
```

健康检查：

```bash
curl http://localhost:3010/health
```

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
| C→S | `game:start` | 开始新一局 |
| C→S | `game:action` | `{ action: 'fold' \| 'call' \| 'raise' }` |
| S→C | `gameState` | 广播完整状态 |

## 测试牌型判断

```bash
npm run test:evaluator
```
