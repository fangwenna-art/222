# Animation Layer

独立于 UI 的**事件驱动**动效系统。UI 只渲染 state，动画只由 `emit(eventName, payload)` 触发。

## 架构

```text
gameState 更新
  → GameStateAnimationBridge.process(prev, next)   // 差分 → emit
  → renderGameState(next)                          // 纯 UI，无 animation logic
  → AnimationLayer.syncToDom()                     // 按 Rules Map 播放
```

## 事件

| 事件 | 触发来源 | 动画 |
|------|----------|------|
| `deal_cards` | 新一局 preflop | 牌从牌堆飞向各座位 |
| `chip_move` | 盲注 / call / raise 日志 | 筹码飞向底池 |
| `player_turn_change` | activePlayerId 变化 | 当前玩家高亮过渡 |
| `player_raise` | bet / raise / allin 日志 | bet stack bounce |
| `player_call` | call 日志 | bet stack bounce（较短） |
| `player_fold` | fold 日志 | fade + rotate |

## 文件

| 文件 | 职责 |
|------|------|
| `animationEvents.js` | `AnimationEventBus` + `emit` |
| `animationRules.js` | event → `{ animation, duration, easing }` |
| `animationLayer.js` | 订阅事件，执行动效 |
| `gameStateBridge.js` | gameState 差分 → emit |
| `index.js` | `create()` / `orchestrateStateUpdate()` |
| `../animation.css` | 动效样式 |

## 调试

```javascript
TexasHoldemAnimation.getBus().on('*', (e) => console.log(e));
```

## 约束

- **禁止**在 `renderGameState` 或 UI 组件内写 animation logic
- **禁止** UI 直接调用 `AnimationLayer.play`
- 仅 `GameStateAnimationBridge` 与测试可调用 `emit`
