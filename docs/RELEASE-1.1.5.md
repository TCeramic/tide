# Tide 1.1.5

## 本次修复

- **安装向导现在真的会弹出来**：1.1.4 及以前，检查更新下载完成后点「打开安装向导」，
  Tide 会关掉自己、然后什么都不发生。原因是启动安装器的那条等待命令是用
  `spawn(..., { detached: true })` 挂在 Tide 进程下面的，Windows 上 Electron 会给自己的
  子进程套一个「父进程一退出就整组杀掉」的 Job，`detached` 并不能脱离它——Tide 一退，
  等待脚本先被干掉，安装器永远没被启动。
  现在改成两步：先写一个只做「等 Tide 退出 → 启动安装器」的 VBScript（UTF-16LE + BOM，
  中文路径也不会乱码），再用 WMI 的 `Win32_Process.Create` 让系统去启动 `wscript`。
  WMI 创建的进程挂在 `WmiPrvSE` 下，不在 Tide 的 Job 里，Tide 退出后它还在，能正常等
  进程结束并拉起安装器，安装包也能收到 `/D=<安装目录>`。
- 启动失败不再静默退出：WMI 调用返回非 0 时设置页会显示「无法启动安装程序，请手动运行
  下载好的安装包」，Tide 保持打开，用户还能自己去装。
- 队列入口只保留悬停展开（1.1.4 已生效，这里一并说明）：左侧感应区靠近时自动弹出播放
  队列，那个跟着面板露出来的图标按钮已隐藏。

## 发布要求（云更新）

- Release tag 必须是 `v1.1.5`。
- 资产名必须逐字为 `Tide-Setup-1.1.5-x64.exe`（优先）或 `Tide-1.1.5-win.zip`（回退）。
- 建议同传 `SHA256SUMS.txt`，每行格式 `<64 位小写 sha256>  <资产名>`。
- 资产链接必须位于 `https://github.com/TCeramic/tide/releases/download/` 之下。

## 本次构建产物

- `Tide-1.1.5-win.zip` — 207,397,963 B
  SHA256 `d6ea2de682128010d6ed2e2b5716eb95b33477f0a202e90ffddf28deb016a41a`
- `Tide-Setup-1.1.5-x64.exe` — 151,198,879 B
  SHA256 `27ff7e808ea39853845cf1a2a8779c2a494290bd293a13df0ff81a3b52810649`

（构建命令同 1.1.4：electron-builder 走系统代理会失败，用
`--config.electronDist=node_modules/electron/dist` 指定本地 Electron 发行版。）

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
npx electron-builder --win --x64 --dir --config.directories.output=release/tide-1.1.5 --config.electronDist=node_modules/electron/dist
tar -a -c -f release/tide-1.1.5/Tide-1.1.5-win.zip -C release/tide-1.1.5/win-unpacked *
npx electron-builder --win nsis --x64 --prepackaged release/tide-1.1.5/win-unpacked --config.directories.output=release/tide-1.1.5
```
