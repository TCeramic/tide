# Tide 1.1.0 发布说明

## 版本
- 应用版本：`1.1.0`（`package.json` / `package-lock.json` 已同步）
- 应用 ID：`dev.tceramic.tide`
- 目标平台：Windows x64

## 产物
| 文件 | 大小 | SHA256 |
| --- | --- | --- |
| `Tide-1.1.0-win.zip` | 207,309,705 B | `7BA7796ECE424CF7C6409CAEB79342E161AD05218185CB2CE00DD1EAF53BE766` |
| `Tide-Setup-1.1.0-x64.exe` | 151,114,375 B | `FFC82C91786F44DCFCF039B984499D14A9FE6649ED0C933818185EE64F0EBF0E` |
| `SHA256SUMS.txt` | — | 列出上面的 zip 哈希 |

## 1.1.0 主要变化
- 修复透镜主题下「字体」设置点了没反应：透镜外壳的字体被设计系统 `body.lg-stage` 的 `font` 简写写死，现按点阵同样的方式绑定 `--tide-font`，系统 / 宋体 / 衬线 / 等宽 立即生效。
- 首页 TIDE 点阵标识放大到合适比例，并按窗口高度自适应（1600×1000 约 250px 宽，1600 高约 300px 宽）。
- 修复首页网格首行固定 44px 导致 TIDE 顶部被裁、底部压住卡片的问题；首行改为随标识高度伸缩。
- 修复「你的音乐库」卡片把「8 首 / 3 首」计数标签裁掉的布局问题。
- 舞台（透镜 / 点阵）下的播放栏改为真正的透镜玻璃，并折射当前舞台画面。
- 点阵主题搜索框去掉聚焦时外露的圆弧边缘（透镜主题不变）。
- 其余：设置页胶囊按钮、静态音乐脉络树、搜索页头部去掉薄荷色横条、舞台词粒度分词与字号修正等。

## 云更新要求（重要）
设置页的「检查更新」不经 electron-updater，而是读取 GitHub Release：

1. tag 必须是 `v1.1.0`（形如 `v1.1.0`，更新器用 semver 比较）。
2. Release 必须附带资产 **`Tide-1.1.0-win.zip`**，名称必须逐字一致（更新器按 `Tide-<version>-win.zip` 精确匹配）。
3. 建议同时上传 `SHA256SUMS.txt`（格式 `<64位十六进制>  Tide-1.1.0-win.zip`），更新器会用它校验下载内容；若 Release 资产自带 `digest` 则优先用 digest。
4. `Tide-Setup-1.1.0-x64.exe` 是给新用户的一次性安装包，**更新器不会使用它**，可选上传。
5. 资产下载地址必须位于 `https://github.com/TCeramic/tide/releases/download/<tag>/<asset>`。

更新器逻辑：`src/main/update-feed.ts`（`RELEASE_API`、`releaseFromJson`、`newerVersion`），下载校验与解压：`src/main/update-host.ts`（校验大小与 sha256 → `Expand-Archive` 到 `userData/updates/<version>-<ts>` → 校验 `Tide.exe` 与 `resources/app.asar` → 启动并退出）。

## 复现构建
```powershell
node scripts/build.mjs
# `--win zip` 的 7za 可能卡死；改为先出目录，再用 tar 打包，再基于目录出安装包。
npx electron-builder --win --x64 --dir --config.directories.output=release/tide-1.1.0
tar -a -c -f release/tide-1.1.0/Tide-1.1.0-win.zip -C release/tide-1.1.0/win-unpacked *
npx electron-builder --win nsis --x64 --prepackaged release/tide-1.1.0/win-unpacked --config.directories.output=release/tide-1.1.0
```

## 验证
- `npm run verify:design-systems` → Verified 70 original files at `7a424c93b9be13cf835b91ea67495fec2ec0584e`
- `npm run typecheck` → 通过
- `npm test` → 181 pass / 0 fail（31 suites）
- `node scripts/desktop-redesign-smoke.cjs` → 99 张截图矩阵通过（`artifacts/desktop-redesign-r28`）