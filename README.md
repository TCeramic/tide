# 潮汐 Tide

潮汐是一个 **Windows 优先** 的个人桌面音乐播放器（Electron）。这一版是 **M1 内核**：窗口、本地回环 API、播放状态机，以及留给沉浸界面的三层画布。还没有登录，也没有真正出声。

Tide is a **Windows-first** personal desktop music player. This revision is the **M1 kernel**: a window, a local loopback API, a playback state machine, and a three-layer canvas for a later immersive UI. It does not log in and it does not play audio yet.

## 风险声明 / Risk

潮汐 **不是** 网易云音乐的官方客户端，也未获其授权。后续若接入非官方接口或 Cookie（例如 `MUSIC_U`），接口可能失效，账号也可能受到限制。软件仅供个人自用，后果由使用者自行承担。

Tide is an **unofficial** client and is not authorized by NetEase Cloud Music. Later milestones may call unofficial APIs or store cookies such as `MUSIC_U`. Those calls can stop working and can put an account at risk. Personal use only; you accept that risk.

本仓库代码为自写，采用 MIT。音源服务计划在 `src/api/server.ts` 上挂载 [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi)，以其自身许可证为准。不要把其他播放器（包括 Mineradio，GPL-3.0）的源码或资源抄进本仓库。

The code in this repository is original and MIT-licensed. The music API is planned as a mount of [NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) inside `src/api/server.ts`, under that project's license. Do not copy source or assets from other players, including Mineradio (GPL-3.0), into this repo.

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
{ "ok": true, "service": "tide", "version": "0.1.0" }
```

`npm test` 跑状态机和 `/health`。`npm run typecheck` 只做类型检查。

## 目录 / Layout

```
src/main/                 窗口生命周期；启动/停止 API 子进程；退出时清理
src/preload/              contextBridge 上的最小 IPC（window.tide）
src/core/events.ts        事件总线
src/core/playback/        idle / loading / playing / paused / error
src/renderer/             #stage 动效层、#lyrics 歌词层、#chrome 控件层
src/renderer/clock.ts     requestAnimationFrame 时钟，供以后的动效使用
src/api/server.ts         本地回环服务。当前只有 GET /health
```

播放事件：`play`、`pause`、`seek`、`volume`、`queue`、`track-change`。

## 下一步 / Next

继续在 `feat/m1-kernel` 上提交即可。M2 再把 NeteaseCloudMusicApi 接到 `src/api/server.ts`，并做登录与 Cookie。这一轮不要接 Spotify、QQ，也不要加壁纸或粒子系统。

Keep committing on `feat/m1-kernel`. M2 mounts NeteaseCloudMusicApi in `src/api/server.ts` and adds login. Spotify, QQ, wallpaper, and particle systems stay out until the kernel milestones are done.
