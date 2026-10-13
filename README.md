# 潮汐 Tide

潮汐是一个 **Windows 优先** 的个人桌面音乐播放器（Electron）。当前是 **M2**：窗口与播放状态机还在，并已接上网易云登录和歌单列表。还没有真正出声（那是 M3）。

Tide is a **Windows-first** personal desktop music player. This revision is **M2**: the window and playback state machine are in place, and NetEase login plus playlist listing work. Audio playback is M3.

## 风险声明 / Risk

潮汐 **不是** 网易云音乐的官方客户端，也未获其授权。登录使用的是非官方接口 [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)（本仓库钉在 `4.32.0`，MIT）以及浏览器 Cookie（必须包含 `MUSIC_U`）。

这可能不符合网易云音乐的服务条款。接口和 Cookie 会失效，账号也可能被限制。软件只供个人自用，后果由使用者自行承担。不要把 Cookie 提交进 git，也不要发给别人。

Tide is an **unofficial** client and is not authorized by NetEase Cloud Music. Login goes through [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) (pinned at `4.32.0`, MIT) and a browser cookie that must include `MUSIC_U`.

That can conflict with NetEase's terms of service. The API and the cookie can stop working, and the account can be limited. Personal use only; you accept that risk. Do not commit the cookie or send it to anyone.

本仓库代码为自写，采用 MIT。不要把其他播放器（包括 Mineradio，GPL-3.0）的源码或资源抄进本仓库。

The code in this repository is original and MIT-licensed. Do not copy source or assets from other players, including Mineradio (GPL-3.0), into this repo.

## 开发 / Develop

需要 Node.js 22+。

```bash
npm install
npm start
```

`npm start` 会编译并打开窗口。主进程在 `127.0.0.1:39271` 拉起 API 子进程（可用环境变量 `TIDE_API_PORT` 改端口）。关掉窗口后子进程会退出。

```bash
curl http://127.0.0.1:39271/health
```

```json
{ "ok": true, "service": "tide", "version": "0.2.0" }
```

`npm test` 跑状态机、Cookie 判断和登录路由。`npm run typecheck` 只做类型检查。

## 登录 / Login

左侧「登录网易云」面板有两条路，扫码需要手机上的网易云音乐：

1. **扫码。** 点「显示二维码」，用网易云 App 扫码并在手机上确认。二维码过期就再点一次。
2. **粘贴 Cookie。** 从已登录的网页版复制请求头里的 Cookie，贴进输入框，点「保存 Cookie」。内容里必须有 `MUSIC_U`，否则会被拒绝。

登录成功后，面板列出账号昵称和歌单（名称与曲数）。这一步只读列表，不会播放。

Cookie 写在 Electron `userData` 目录的 `netease.cookie`（Windows 上一般是 `%APPDATA%/tide/netease.cookie`）。Unix 上文件权限是 `0600`。`.gitignore` 已忽略 `*.cookie` 和 `userData/`。

点「退出登录」会删掉这个文件。如果保存的 Cookie 已失效，面板会写明「登录已失效，请重新登录」，可以扫码、粘贴新 Cookie，或点「清除登录」。

The left panel accepts a NetEase QR login or a pasted cookie that contains `MUSIC_U`. After login it lists your playlists. The cookie is stored only in Electron userData as `netease.cookie`. Logout deletes it. An invalid cookie asks you to log in again.

完成一次真实扫码需要能打开网易云 App 的手机，开发机上不一定能代点确认。

## 目录 / Layout

```
src/main/                 窗口；API 子进程；退出时清理；登录 IPC
src/preload/              contextBridge（window.tide）
src/core/events.ts        事件总线
src/core/playback/        idle / loading / playing / paused / error
src/renderer/             #stage 动效层、#lyrics 歌词层、#chrome 控件与歌单
src/renderer/clock.ts     requestAnimationFrame 时钟
src/api/server.ts         127.0.0.1 上的 /health 与 /session
src/api/netease.ts        调用 NeteaseCloudMusicApi 的登录和歌单函数
```

播放事件：`play`、`pause`、`seek`、`volume`、`queue`、`track-change`。这些还不驱动真实音频。

## 下一步 / Next

继续在 `feat/m1-kernel` 上提交即可。M3 再做搜索和播放。不要接 Spotify、QQ，也不要加壁纸或粒子系统。

Keep committing on `feat/m1-kernel`. M3 is search and playback. Spotify, QQ, wallpaper, and particle systems stay out.
