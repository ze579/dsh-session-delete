# 发布到插件市场

这个包已经按 DSH 的 bundle 规范准备好，并且自带一份能通过 DSH 官方校验器的**格式 1 插件索引**。把它放进市场分两步：**先让包有一个公开来源**，**再让市场索引指向它**。

## 已经准备好的东西

| 文件 | 用途 |
|---|---|
| `dsh-session-delete-0.1.7.tgz`（`market/`） | `pnpm pack` 产物，10 个文件，15 KB，可直接分发 |
| `market/make-index.mjs` | 生成并**自动用 DSH 的 `parseMarketIndex` 校验**索引 |
| `market/index.example.json` | 示例输出（仓库地址与 commit 是占位值，别直接发布） |
| `locale/{zh,en}.json` | 插件页标题/描述，已标注适用版本 |

兼容性写在索引的 `engines.dsh` 里，当前是：

```json
"engines": { "dsh": ">=0.2.2-rc.3 <0.3.0" }
```

依据：只在 DSH `0.2.2-rc.3`（桌面版）实测过，用到 `webServer.register`、`workspaceRegistry.archiveSession/detachSession`、`contextMenus`、`shell.overlay`。

## 包名

包名是 `dsh-session-delete`，与 `client.js` 里的客户端模块 id 一致。发 npm 前确认这个名字在 npm 上可用。

## 路线 A：GitHub 仓库（推荐，不需要 npm 账号）

```bash
git init && git add -A && git commit -m "dsh-session-delete 0.1.7"
git remote add origin https://github.com/<你>/dsh-session-delete.git
git push -u origin main
git rev-parse HEAD        # 40 位 commit
node market/make-index.mjs https://github.com/<你>/dsh-session-delete <commit>
```

`make-index.mjs` 会写出 `market/index.json` 并打印校验结果（`validated: ... engines.dsh = ...`）。把 `index.json` 放到任意 HTTPS 上即可，最省事的是同一仓库 + jsDelivr：

```
https://cdn.jsdelivr.net/gh/<你>/dsh-session-delete@main/market/index.json
```

## 路线 B：npm

```bash
npm publish --access public
node market/make-index.mjs --npm     # source 类型为 npm，索引里的版本取 package.json
```

索引同样托管到 HTTPS（jsDelivr 直接取 npm 包内的文件即可）。

## 第 2 步：让用户在 DSH 里看到它

**自建索引（立刻可用，不需要任何审核）**

1. DSH → 插件 → **发现** → 添加索引源；
2. 填上面的 `index.json` URL；
3. 搜索「会话删除」→ 安装。

**上架社区市场（awesome-dsh-plugin，也就是 dshmarket 的目录）**

该目录来自 `github.com/awesome-dsh-plugin/awesome-dsh-plugin`，收录方式是给仓库提 PR。条目大致长这样（字段照抄目录里其他条目）：

```json
{
  "name": "dsh-session-delete",
  "owner": "<你的 GitHub 用户名>",
  "url": "https://github.com/<你>/dsh-session-delete",
  "category": "session",
  "description": {
    "zh": "在会话右键菜单里删除会话，两次确认；删除文件、账本与缓存（适用 DSH 0.2.2-rc.3 及以上）。",
    "en": "Delete a session from its context menu with two confirmations (DSH 0.2.2-rc.3+)."
  },
  "install": "dsh plugin --profile web add github:<你>/dsh-session-delete",
  "icon": "https://raw.githubusercontent.com/<你>/dsh-session-delete/main/icon.svg"
}
```

注意：目录当前主要收录**有 npm 版本**的插件；纯 GitHub 条目也可能被收录，但先发 npm 更稳。

## 还缺什么

最后两步都需要**外部账号**，我这边没有凭据，无法代办：

- 一个公开来源：GitHub 仓库（需要 push 权限 / PAT）或 npm 包（需要 `npm publish` token）；
- 以及（可选）awesome-dsh-plugin 的 PR（需要 GitHub 账号）。

把仓库地址/ token 给我，或者你自己执行上面的命令——索引那一步的生成与校验我可以随时帮你跑。

## 上架 awesome-dsh-plugin（dshmarket 的目录）

该目录的数据源是 `data/plugins/<owner>__<repo>.yml`，一个插件一个文件。条目已经准备好：

```
market/awesome-dsh-plugin/ze579__dsh-session-delete.yml
```

提 PR 的步骤：

1. 给仓库加 topic `dsh-plugin`（仓库首页 About 旁的齿轮 → Topics）；
2. fork `awesome-dsh-plugin/awesome-dsh-plugin`；
3. 在 fork 里新增 `data/plugins/ze579__dsh-session-delete.yml`，内容用上面那个文件；
4. 向 main 开 PR，标题例如 `Add ze579/dsh-session-delete`。

注意两条硬性要求：

- **仓库创建需满 1 天**（CI 自动检查）。本仓库创建于 2026-11-16，所以最早 **2026-11-17** 再提 PR。
- 图标要求是 GitHub 托管的**位图**（PNG/JPEG）。本包只有 `icon.svg`，所以条目里没有写 `icon`，会回退到作者头像；要自定义卡片图标，补一张 `assets/icon-180.png` 再把 `icon:` 加进条目。

描述必须与代码一致（他们会对仓库核对），现在这版描述里提到的行为都能在 `index.js` / `client.js` 里找到对应实现。
