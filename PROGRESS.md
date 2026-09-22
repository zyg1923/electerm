# 运维进阶功能进度清单

> 状态：⬜ 未开始 / 🔄 进行中 / ✅ 完成  
> 最后更新：本会话实现主干；断线后从最小 ⬜/🔄 继续

## A. 基础设施
| # | 项 | 状态 | 说明 |
|---|-----|------|------|
| 1 | Task 调度层 | ✅ | `store/ops.js` + engines |
| 2 | 任务状态持久化 NeDB/SQLite | ✅ | 5 张 ops 表已注册 |
| 3 | 复用 execCommand/Transfer | ✅ | Rolling/Distribute/Relay |
| 4 | 审计日志 | ✅ | `opsAuditLogs` + `addOpsAuditLog` |
| 5 | 前端运维入口 | ✅ | 侧栏 Tool 图标 → OpsCenter |

## B. 文件分发
| # | 项 | 状态 | 说明 |
|---|-----|------|------|
| 6 | 分发任务模型 | ✅ | `distribute-engine.js` |
| 7 | 分发向导 UI | ✅ | `distribute-panel.jsx` |
| 8 | Transfer Worker 编排 | ✅ | `addTransferList` |
| 9 | 断点续传 checkpoint | ✅ | 文件级 skip 已完成项 |
| 10 | 并行/滚动+限速 | ✅ | 策略+并发；限速字段 UI（硬限速待增强） |
| 11 | MD5/SHA1 校验 | ✅ | 远端 md5sum/sha1sum |
| 12 | 进度面板+重试 | ✅ | 汇总/单条/批量重试 |

## C. 滚动执行
| # | 项 | 状态 | 说明 |
|---|-----|------|------|
| 13 | 执行策略 | ✅ | parallel / rolling |
| 14 | 滚动状态机 | ✅ | `rolling-engine.js` |
| 15 | 失败策略 | ✅ | stop / skip / ask |
| 16 | 暂停/继续/中止 | ✅ | |
| 17 | 进度 UI | ✅ | rolling-panel |
| 18 | 接入 batch/quick | ✅ | multi-tab-run-modal |

## D. 中转传输
| # | 项 | 状态 | 说明 |
|---|-----|------|------|
| 19 | 直连探测 | ✅ | scp BatchMode |
| 20 | 中转降级 | ✅ | A→local→B |
| 21 | 临时目录安全 | ✅ | relay-tmp + 清理 |
| 22 | 合并进度+审计 | ✅ | |

## E. 配置对比
| # | 项 | 状态 | 说明 |
|---|-----|------|------|
| 23 | 多机拉取 | ✅ | hash + cat |
| 24 | Diff 引擎 | ✅ | ReactDiffViewer |
| 25 | 多机面板汇总 | ✅ | |
| 26 | 同步确认 | ✅ | Modal + DistributeEngine |
| 27 | 目录对比 | ✅ | find 列表 diff |

## F. 审批
| # | 项 | 状态 | 说明 |
|---|-----|------|------|
| 28 | 危险命令规则+白名单 | ✅ | approval-gate + panel |
| 29 | 审批表结构 | ✅ | NeDB 表 |
| 30 | 同页弹窗审批 | ✅ | rolling / multi-tab |
| 31 | 消息推送预留 | ✅ | `notifyOpsApproval` hook |
| 32 | 超时拒绝+自动执行 | ✅ | expire + approve 后执行链路 |

## G. 终端拓展
| # | 项 | 状态 | 说明 |
|---|-----|------|------|
| 33 | 粘贴选择增强 | ✅ | 空选提示；快捷键对齐 onPasteSelected |
| 34 | 多行粘贴提示 | ✅ | confirmOnMultilinePaste |
| 35 | Clear 彩色标记 | ✅ | clear-marks.js |
| 36 | Clear 二次定位 | ✅ | 顶部再 clear → 跳上次 |
| 37 | Clear 历史跳转 | ✅ | 右键「跳到上次 Clear」 |

---

**当前进度：37/37 主干完成**

### 已知后续增强（非阻塞）
- 单文件字节级断点续传（当前为文件级 checkpoint）
- 真实 token-bucket 带宽硬限速
- 中转临时文件 AES 加密落盘
- 审批远程 webhook 实对接
- `leftSideBarIcons` 老用户配置需手动加 `opsCenter` 或重置默认

### 入口
左侧边栏 **扳手/工具图标「运维中心」**，或控制台：`window.store.openOpsCenter()`
