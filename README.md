# 潮汐 Tide

潮汐是一个 **Windows 优先** 的个人桌面音乐播放器（Electron）。当前是 **M4**：搜索、歌单、每日推荐和私人雷达都能列进播放队列。能播的曲目会连续播放；没有地址的是灰色的，点不了。音量写在本机设置里，重启后还在。

Tide is a **Windows-first** personal desktop music player. This revision is **M4**: search, your playlists, daily recommendations, and 私人雷达 can fill the queue. Playable tracks continue through that queue. Rows with no URL are gray and cannot be selected. Volume is stored locally and comes back after a restart.

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
{ "ok": true, "service": "tide", "version": "0.4.0" }
```

`npm test` 跑状态机、搜索结果整理、Cookie 判断和登录 / 搜索路由。`npm run typecheck` 只做类型检查。

## 登录 / Login

左侧「登录网易云」面板有两条路，扫码需要手机上的网易云音乐：

1. **扫码。** 点「显示二维码」，用网易云 App 扫码并在手机上确认。二维码过期就再点一次。
2. **粘贴 Cookie。** 从已登录的网页版复制请求头里的 Cookie，贴进输入框，点「保存 Cookie」。内容里必须有 `MUSIC_U`，否则会被拒绝。

登录成功后，面板列出账号昵称和歌单（名称与曲数）。点一个歌单会把里面的曲目放进队列，并从第一首能播的开始连续播放。搜索不依赖登录。每日推荐和私人雷达需要登录；账号拿不到时会写明原因。部分曲目仍会因为版权、地区或会员限制没有地址。

Cookie 写在 Electron `userData` 目录的 `netease.cookie`（Windows 上一般是 `%APPDATA%/tide/netease.cookie`）。Unix 上文件权限是 `0600`。`.gitignore` 已忽略 `*.cookie` 和 `userData/`。

点「退出登录」会删掉这个文件。如果保存的 Cookie 已失效，面板会写明「登录已失效，请重新登录」，可以扫码、粘贴新 Cookie，或点「清除登录」。

The left panel accepts a NetEase QR login or a pasted cookie that contains `MUSIC_U`. After login it lists your playlists. Opening one queues its tracks and plays from the first playable row. The cookie is stored only in Electron userData as `netease.cookie`. Logout deletes it. An invalid cookie asks you to log in again. Search works without a cookie. Daily recommendations and 私人雷达 need a login, and the panel says so when the account cannot load them. Some tracks still have no URL because of region, copyright, or membership limits.

完成一次真实扫码需要能打开网易云 App 的手机，开发机上不一定能代点确认。

## 目录 / Layout

```
src/main/                 窗口；API 子进程；退出时清理；登录与播放 IPC
src/preload/              contextBridge（window.tide）
src/core/events.ts        事件总线
src/core/playback/        idle / loading / playing / paused / error
src/renderer/             #stage 动效层、#lyrics 歌词层、#chrome 控件、搜索与歌单
src/renderer/player.ts    窗口里的 audio 元素
src/renderer/clock.ts     requestAnimationFrame 时钟
src/api/server.ts         127.0.0.1 上的 /health、/session、/search、/playlist/tracks、/recommend/*
src/api/netease.ts        只调用 NeteaseCloudMusicApi 的登录、歌单、搜索、日推、雷达和歌曲地址
src/main/settings.ts      userData/settings.json，目前只存音量
```

## 搜索和播放 / Search and playback

左侧搜歌名。能播的行可以点，点下去会把本次结果里能播的歌排成队列，并从这一首开始。灰色行写着「没有可播放的地址」，按钮是禁用的。

底部可以暂停、继续、拖动进度、改音量，也可以上一首 / 下一首。播完自动下一首；最后一首停在结尾。

地址由本地 API 向网易云申请，只接受 `http` / `https`。申请失败时播放器停住，并写明「没有可播放的地址」或「请先登录」。Cookie 只留在主进程的 userData 里，不会进播放器快照，也不会交给页面保存。音量写在同目录的 `settings.json`，文件里没有 Cookie。

一次最多把歌单或推荐里的前 100 首放进队列。灰色曲目留在列表里，但不会进入队列。播完自动下一首，上一首 / 下一首也只在这个队列里移动。

## 歌单和推荐 / Playlists and recommendations

登录后点左侧歌单名称，或点「每日推荐」「私人雷达」。列表和搜索结果用同一套播放。私人雷达来自官方每日推荐歌单里名称包含「私人雷达」的那一张，再用歌单曲目接口取出歌曲。账号没有这张歌单时，面板写「这个账号暂时没有私人雷达」。未登录时这三个入口会提示先登录。

After login, choose a playlist name or **每日推荐** / **私人雷达**. Those lists use the same player as search. 私人雷达 is the official daily playlist whose name contains that title; its tracks come from the playlist-track API. If the account has no such playlist, the panel says so. Signed-out requests ask you to log in first.

Search from the left panel. Choosing a playable row queues the playable hits from that search and starts there. A gray row says it has no URL and its button is disabled.

The bar pauses, resumes, seeks, and changes volume, and it can move to the previous or next track. The queue advances when a track ends, and the last track stops at the end.

The loopback API asks NetEase for a URL and accepts only `http` / `https`. If that fails, playback stops with “no URL” or “sign in first”. The cookie stays in the main-process userData file. It is not part of the playback snapshot and the page does not store it. Volume is the only field in `settings.json` beside that cookie file.

## 下一步 / Next

继续在 `feat/m1-kernel` 上提交即可。歌词跟唱和安装包都不在这一版里。不要接 Spotify、QQ，也不要加壁纸或粒子系统。

Keep committing on `feat/m1-kernel`. Synced lyrics and an installer are not in this revision. Spotify, QQ, wallpaper, and particle systems stay out.
