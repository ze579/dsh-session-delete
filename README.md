# 会话删除 / Session delete

在 DSH 的会话列表里右键任意一行，菜单最下方出现红色的「删除会话」，两次确认后删除这一段对话。

> **适用版本 / Tested on**: DeepSeek Harness `0.2.2-rc.3`（桌面版）。声明的兼容范围：`>=0.2.2-rc.3 <0.3.0`。
> 更低版本没有验证过：插件用到的 `webServer.register`、`workspaceRegistry.archiveSession/detachSession`、`contextMenus`、`shell.overlay` 都可能在旧版本上不同。

## 安装

- 市场 / 索引：在「插件 → 发现」里添加索引源后一键安装；
- 本地目录：插件页 →「添加插件」→ 选择包目录。

## 用法

1. 右键会话 →「删除会话」；
2. 弹窗一：「继续」；
3. 弹窗二：「永久删除」；
4. 删除后该行消失，右下角出现「已删除会话：标题」。

## 删除什么

- `$DSH_HOME/sessions/<项目>/<会话 id>/`；
- 工作区账本中的条目（含归档/置顶集合）；
- `$DSH_HOME/storages/session_projcache/sessions/<会话 id>.json`。

不删除附件、工作区目录和其他会话的数据。

## 行为

- 运行中的会话拒绝删除（用 DSH 自己的 `workspace/session-activity` 判定，判定失败按运行中处理）。
- 仍在内存里的会话先归档再删，让它立刻从默认列表消失；归档标记由启动清理在确认会话真的不存在后摘掉。
- 文件已丢失但还登记着时，再删一次会把账本和缓存一并清干净。

## 限制

- DSH 没有公开的会话销毁接口，内存副本由 DSH 自己释放；体现在列表里就是「已归档」兜底。
- 只支持本机 owner；路由只监听回环并要求同源请求。

完整说明见 [docs/DETAIL.md](docs/DETAIL.md)。
