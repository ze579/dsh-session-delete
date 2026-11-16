# 会话删除 / Session delete

在会话列表里右键任意一行，菜单最下方会出现红色的「删除会话」。

## 使用

1. 右键会话行 →「删除会话」；
2. 第一个弹窗说明将删除这一段对话，点「继续」；
3. 第二个弹窗提示不可恢复，点「永久删除」；
4. 删除成功后该行消失，右下角出现「已删除会话：标题」提示。

## 删除什么

- 会话记录目录 `$DSH_HOME/sessions/<项目>/<会话 id>/`（`session.v4.jsonl.zstd` 等）；
- 工作区账本里这条会话的条目（含归档集合、置顶集合）；
- 该会话的投影缓存 `$DSH_HOME/storages/session_projcache/sessions/<会话 id>.json`。

不删除：附件库里的文件、工作区目录、其他会话的任何数据。

## 行为细节

- **正在运行的会话不能删**：宿主用 DSH 自己的 `workspace/session-activity` 判定（回合、子智能体、后台任务、定时任务），有活动就拒绝并说明是哪一类；判定本身报错时按「正在运行」处理（fail closed）。
- **仍在内存里的会话**（刚用过、宿主还没卸载）：先归档再删，让它立刻从默认列表消失——归档是 DSH 里唯一能立刻隐藏一行的公开手段。
- **文件已丢失但还登记着**（上次删除中断、或手工删过目录）：仍然可以再删一次，插件会把账本和缓存一并清干净，返回成功而不是 404。
- 删除不可恢复，不经过系统回收站。
- 只支持本机 owner 使用；路由只绑定回环地址，并要求同源请求（`Origin` 与 `webServer.getOrigin()` 一致）。

## 启动清理

每次 DSH 启动约 8 秒后，插件扫一遍注册表里的归档/置顶集合：凡是**既不在内存、也没有会话目录、也没有缓存**的 id，就调用 `unarchiveSession` / `unpinSession` 释放。这样删掉的会话在下次启动后连「已归档标记」都不留。

- 只有 `sessions/` 根目录可读时才动手；读不到就整轮跳过。
- **只处理插件自己隐藏过的 id**：删除时会把这类 id 记到 `$DSH_HOME/dsh-session-delete/purged.json`，启动清理只认这份名单。你手动归档的会话，即使文件被移走或损坏，也永远不会被这条清理动到。
- 仍在内存里的会话会被跳过——它需要那条归档标记来隐藏自己；下一次启动仍会继续尝试。
- 关掉：在该插件 `config` 里设 `startupCleanup: false`；延迟用 `startupCleanupDelayMs`（默认 8000）。

## 实现

- Host：`index.js` 注册 `POST /dsh-session-delete/api`。处理器校验方法与来源，用 `readdir` 在 `sessions/` 下按会话 id 定位目录（不依赖内部路径编码）；内存中的会话先 `archiveSession()` 隐藏，随后 `rm -rf`，再 `unarchiveSession()`（未隐藏时）/ `detachSession()` / `unpinSession()` 清理账本，最后删缓存。任一可选服务用 `ctx.get()` 读取——Cordis 对未 inject 的服务做属性访问会直接抛错。
- 启动清理：`cleanupStaleArchives()`，由 `startupCleanupDelayMs` 定时触发，可配置关闭。
- Client：`client.js` 向 `contextMenus` 注册 `session` 目标动作，向 `shell.overlay` 注册自写弹窗（不加载 Harness 的 primitives 包，样式用 `--dsw-alias-*` 令牌并带兜底值），并注册 `zh`/`en` 文案。

## 验证

- `node test/host.test.mjs`：定位、删除、运行中拒绝、缺失会话、账本与缓存清理、归档隐藏、启动清理四种情形；`node test/client.test.mjs`：菜单与弹窗接线。
- 安装后在页面里右键任意会话，确认两个弹窗、Esc/取消、运行中拒绝提示与成功提示。
