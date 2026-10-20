# Tide 1.1.1

本次发布把「设置 → 关于 → 检查更新」改成真正的覆盖升级：不再下载 zip 解压出一份便携副本，而是下载 NSIS 安装包，退出 Tide 后打开安装向导，由你把新版本装回原来的安装目录。

## 更新器行为（1.1.1 起）

1. 检查更新：读取 GitHub 最新 release，版本更高才提示。
2. 下载并安装：下载 `Tide-Setup-<version>-x64.exe` 到 `%APPDATA%\Tide\updates`，校验大小与 SHA-256。
3. 安装向导：弹出确认框，选择「打开安装向导」后 Tide 退出，安装程序以当前安装目录作为默认路径启动；向导里可以改路径，默认仍会创建（或复用）名为 `Tide` 的文件夹。
4. 完成后可直接从向导最后一页启动新版；账号、设置、下载内容都在用户数据目录，不受影响。

便携副本（没有安装器、目录里没有 `Uninstall Tide.exe`）仍然回退到旧的 zip 解压启动流程，避免开发模式误覆盖。

## 其它改动

- 搜索结果里播放单曲（播放按钮、双击、右键菜单、开始播放）不再把播放队列替换成搜索结果，而是按「最近播放」的方式插到当前曲目后面再播，正在听的歌单不会被顶掉；歌单详情页的播放行为不变。

- 版本号 1.1.0 → 1.1.1，关于页显示 1.1.1。
- 安装包默认创建桌面与开始菜单快捷方式（`Tide`），安装完成后可直接启动。
- 关于页按钮改为「下载并安装」，并说明会打开安装向导。

## 发布要求（云更新必须满足）

- tag 必须是 `v1.1.1`（更新器从 `releases/latest` 取 `tag_name`，形如 `v1.1.1`）。
- 资产名必须逐字为 `Tide-Setup-1.1.1-x64.exe`（优先）或 `Tide-1.1.1-win.zip`（回退）；大小 ≤ 600 MB。
- 建议同时上传 `SHA256SUMS.txt`，内容每行 `<64 位 sha256>  <资产名>`；1.1.1 里安装包与便携包各一行。
- 下载链接必须位于 `https://github.com/TCeramic/tide/releases/download/` 下。

## 本次构建产物

- `Tide-Setup-1.1.1-x64.exe`：151,115,067 B，SHA-256 `1925ccf8ef4fa4c3aa1c6b0ec0cc3e2993ea3736ddc0ba006b800f0e3de52cf2`。
- `Tide-1.1.1-win.zip`：207,310,465 B，SHA-256 `2a97feab16890b6beb798424908cf757cb1f585ad24fad84e6ecdf1af530c006`。

## 验证

- `npm run verify:design-systems`：70 files @ 7a424c93。
- `npm run typecheck`：通过。
- `npm test`：182 pass / 0 fail（31 suites，新增「安装包优先于 zip」与「只有 zip 时回退」两条更新源用例）。
- `node scripts/build.mjs` 重建 dist。
