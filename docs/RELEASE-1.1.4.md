# Tide 1.1.4

## 本次修复

- **「换一批」现在真的会换**：网易云 `/personalized` 一天只给一批固定推荐，接口没有
  offset / seed，重复请求拿到的是同一组。现在一次取满一池（24 张）存在本地，
  「换一批」在池子里按每页 8 张翻页；翻到池子末尾会回到开头并顺手重新拉一次池子
  （跨天时就能拿到新的一批）。
- 推荐歌单数量不足一页时不显示「换一批」，避免一个点了没反应的按钮。
- IPC `tide:recommend:playlists` 支持传入条数（1–30，默认 8），主进程会做范围校验，
  本地 HTTP 端本来就是同一套上限。
- **队列入口只保留悬停展开**：左侧感应区仍然在鼠标靠近时自动弹出播放队列，但那个
  会跟着面板一起露出来的图标按钮已隐藏，面板关闭后不会留下多余按钮。

## 发布要求（云更新）

- Release tag 必须是 `v1.1.4`。
- 资产名必须逐字为 `Tide-Setup-1.1.4-x64.exe`（优先）或 `Tide-1.1.4-win.zip`（回退）。
- 建议同传 `SHA256SUMS.txt`，每行格式 `<64 位小写 sha256>  <资产名>`。
- 资产链接必须位于 `https://github.com/TCeramic/tide/releases/download/` 之下。

## 本次构建产物

- `Tide-1.1.4-win.zip` — 207,397,465 B
  SHA256 `0f32a6bddcc0825027b1ac325248536851c9ed60dde06e0e6d63aa796ec6e312`
- `Tide-Setup-1.1.4-x64.exe` — 151,198,564 B
  SHA256 `f5369521d00ca0451f9d2c5a7f10908125ffb71cc6c746c946c81d2115162e84`

复现打包（electron-builder 走系统代理会失败，用本地 Electron 发行版）：

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npx electron-builder --win --x64 --dir --config.directories.output=release/tide-1.1.4 --config.electronDist=node_modules/electron/dist
tar -a -c -f release/tide-1.1.4/Tide-1.1.4-win.zip -C release/tide-1.1.4/win-unpacked *
npx electron-builder --win nsis --x64 --prepackaged release/tide-1.1.4/win-unpacked --config.directories.output=release/tide-1.1.4
```
