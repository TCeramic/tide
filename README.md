# 潮汐 Tide

潮汐是一个 **Windows 优先** 的个人桌面音乐播放器（Electron）。当前是 **M7**：现有界面可以在两套主题之间切换，洗色相位也能调强度。这两项和播放、歌库一样走本机指令总线；写设置仍要明确允许。今日潮汐、搜索、歌单和官方推荐仍走原来的队列。能播的行可以点开播放；没有地址的是灰色的，点不了。

Tide is a **Windows-first** personal desktop music player. This revision is **M7**: the existing window can switch between two themes, and the wash phase has a strength control. Both go through the loopback command bus, and settings writes still need an explicit allow. 今日潮汐, search, playlists, and the official lists still use the same queue. Playable rows can be played. Rows with no URL are gray and cannot be selected.

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

`npm start` 会编译并打开窗口。主进程在 `127.0.0.1:39271` 拉起 API 子进程（可用环境变量 `TIDE_API_PORT` 改端口），并在 `127.0.0.1:39272` 打开指令总线（`TIDE_BUS_PORT`）。关掉窗口后子进程会退出。

```bash
curl http://127.0.0.1:39271/health
```

```json
{ "ok": true, "service": "tide", "version": "0.7.0" }
```

`npm test` 跑状态机、搜索结果整理、今日潮汐排序、收听日志、指令总线、Cookie 判断和登录 / 搜索路由。`npm run typecheck` 只做类型检查。

## 登录 / Login

左侧「登录网易云」面板有两条路，扫码需要手机上的网易云音乐：

1. **扫码。** 点「显示二维码」，用网易云 App 扫码并在手机上确认。二维码过期就再点一次。
2. **粘贴 Cookie。** 从已登录的网页版复制请求头里的 Cookie，贴进输入框，点「保存 Cookie」。内容里必须有 `MUSIC_U`，否则会被拒绝。

登录成功后，面板列出账号昵称和歌单（名称与曲数）。点一个歌单会把里面的曲目放进队列，并从第一首能播的开始连续播放。搜索不依赖登录。「今日潮汐」也不依赖登录：没有收听记录时会说明原因；登录后如果记录还少，会用账号里的「喜欢的音乐」来补。歌单名常常是「昵称喜欢的音乐」，不一定是「我喜欢的音乐」。每日推荐和私人雷达需要登录；账号拿不到时会写明原因。部分曲目仍会因为版权、地区或会员限制没有地址。

Cookie 写在 Electron `userData` 目录的 `netease.cookie`（Windows 上一般是 `%APPDATA%/tide/netease.cookie`）。Unix 上文件权限是 `0600`。`.gitignore` 已忽略 `*.cookie` 和 `userData/`。

点「退出登录」会删掉这个文件。如果保存的 Cookie 已失效，面板会写明「登录已失效，请重新登录」，可以扫码、粘贴新 Cookie，或点「清除登录」。

The left panel accepts a NetEase QR login or a pasted cookie that contains `MUSIC_U`. After login it lists your playlists. Opening one queues its tracks and plays from the first playable row. The cookie is stored only in Electron userData as `netease.cookie`. Logout deletes it. An invalid cookie asks you to log in again. Search works without a cookie. **今日潮汐** does too: an empty listen log explains itself, and a thin log can be filled from the account’s liked playlist after login. That playlist is often named **昵称喜欢的音乐**, not only **我喜欢的音乐**. Daily recommendations and 私人雷达 need a login, and the panel says so when the account cannot load them. Some tracks still have no URL because of region, copyright, or membership limits.

完成一次真实扫码需要能打开网易云 App 的手机，开发机上不一定能代点确认。

## 目录 / Layout

```
src/main/                 窗口；API 子进程；退出时清理；登录与播放 IPC
src/preload/              contextBridge（window.tide）
src/core/events.ts        事件总线
src/core/playback/        idle / loading / playing / paused / error
src/core/tide-today.ts    用本地播放和跳过记录排今日潮汐
src/renderer/             #stage 动效层、#lyrics 歌词层、#chrome 控件、搜索与歌单
src/renderer/player.ts    窗口里的 audio 元素
src/renderer/clock.ts     requestAnimationFrame 时钟
src/api/server.ts         127.0.0.1 上的 /health、/session、/search、/playlist/tracks、/recommend/*
src/api/netease.ts        只调用 NeteaseCloudMusicApi 的登录、歌单、搜索、日推、雷达和歌曲地址
src/main/settings.ts      userData/settings.json，音量、主题、动效、控件显隐、舞台强度
src/main/listen-log.ts    userData/listen-log.json，不含 Cookie
src/shared/commands.ts    指令名称、危险操作和响应清洗
src/main/command-server.ts 127.0.0.1 上的指令 HTTP / WebSocket
```

## 搜索和播放 / Search and playback

左侧搜歌名。能播的行可以点，点下去会把本次结果里能播的歌排成队列，并从这一首开始。灰色行写着「没有可播放的地址」，按钮是禁用的。

底部可以暂停、继续、拖动进度、改音量，也可以上一首 / 下一首。播完自动下一首；最后一首停在结尾。

地址由本地 API 向网易云申请，只接受 `http` / `https`。申请失败时播放器停住，并写明「没有可播放的地址」或「请先登录」。Cookie 只留在主进程的 userData 里，不会进播放器快照，也不会交给页面保存。同目录的 `settings.json` 存音量、主题、动效、控件显隐和舞台强度，不存 Cookie。

一次最多把歌单或推荐里的前 100 首放进队列。灰色曲目留在列表里，但不会进入队列。播完自动下一首，上一首 / 下一首也只在这个队列里移动。

## 歌单和推荐 / Playlists and recommendations

登录后点左侧歌单名称，或点「每日推荐」「私人雷达」。列表和搜索结果用同一套播放。私人雷达来自官方每日推荐歌单里名称包含「私人雷达」的那一张，再用歌单曲目接口取出歌曲。账号没有这张歌单时，面板写「这个账号暂时没有私人雷达」。未登录时这三个入口会提示先登录。

After login, choose a playlist name or **每日推荐** / **私人雷达**. Those lists use the same player as search. 私人雷达 is the official daily playlist whose name contains that title; its tracks come from the playlist-track API. If the account has no such playlist, the panel says so. Signed-out requests ask you to log in first.

## 今日潮汐 / Tide today

「今日潮汐」在搜索下面，和「推荐」里的每日推荐、私人雷达分开。点「查看今日潮汐」只列出曲目，不会自动开播；再点能播的一行，才会进队列并播放。灰色行仍然禁用。

这张列表不调用网易云的推荐接口。它按本机 `userData/listen-log.json` 里的播放和跳过次数来排：播放加分，不到 30 秒就切到后面的曲子算跳过。播完自然进入下一首不算跳过。文件里只有曲目编号、标题、歌手、时长、时间和播放或跳过，没有 Cookie。

不同曲子的播放不足 5 首时，会用已登录账号的喜欢列表来补。优先用网易云标成个人红心歌单的那一张（`specialType` 5）；没有这个字段时，再匹配「我喜欢的音乐」，或以「喜欢的音乐」结尾的名字，例如「神音天2333喜欢的音乐」。只是名字里带这几个字、但不是这张歌单的，不会压过红心歌单。没登录时，空列表会提示登录后再补。已经登录但没匹配到时，不会再叫你去登录。记录够了之后就不再混入这张歌单。界面里没有收藏按钮，所以日志只记播放和跳过。

**今日潮汐** sits under search, apart from **每日推荐** and **私人雷达**. **查看今日潮汐** lists tracks and does not start playback; choosing a playable row queues and plays it. Gray rows stay disabled.

That list does not call NetEase recommendation APIs. It ranks `userData/listen-log.json`: a play counts up, and moving on within 30 seconds counts as a skip. Reaching the end of a track does not. The file stores track id, title, artist, duration, time, and play or skip. It does not store a cookie.

When fewer than five different tracks have been played, the logged-in liked playlist fills the rest. Tide prefers the playlist NetEase marks as the personal liked list (`specialType` 5). Without that field it matches **我喜欢的音乐**, or a name that ends with **喜欢的音乐**, such as **神音天2333喜欢的音乐**. A playlist that merely contains those words does not outrank the marked list. Signed out, an empty log asks you to log in. Already logged in, a failed match does not ask you to log in again. A thicker log no longer mixes that playlist in. There is no like button, so the log records plays and skips only.

Search from the left panel. Choosing a playable row queues the playable hits from that search and starts there. A gray row says it has no URL and its button is disabled.

The bar pauses, resumes, seeks, and changes volume, and it can move to the previous or next track. The queue advances when a track ends, and the last track stops at the end.

The loopback API asks NetEase for a URL and accepts only `http` / `https`. If that fails, playback stops with “no URL” or “sign in first”. The cookie stays in the main-process userData file. It is not part of the playback snapshot and the page does not store it. `settings.json` stores volume, the theme, motion strength, whether the controls are visible, and the stage strength. It does not store the cookie.

## 指令总线 / Command bus

外部脚本只连本机。网易云接口仍由原来的 API 子进程处理，指令总线不挂出 NeteaseCloudMusicApi 的全部路由。

- `GET http://127.0.0.1:39272/health` 不需要令牌，返回 `tide-bus` 和版本。
- `POST /command` 需要请求头 `Authorization: Bearer <令牌>`。令牌在 `userData/bus-token`，64 位十六进制，权限 `0600`。这不是 Cookie。
- WebSocket `ws://127.0.0.1:39272/events?token=<令牌>` 推送播放和会话状态。响应和推送里不会出现 Cookie。

播放指令有 `playback.get`、`play`、`pause`、`seek`、`volume`、`next`、`prev`、`queue`、`playHits`。`playback.volume` 只改当前音量，不写盘。只读指令有 `library.search`、`playlistTracks`、`daily`、`radar`、`tideToday`、`session`，以及 `settings.read`、`appearance.read`。

`settings.write`、`appearance.write`、`session.logout`、`session.clearCookie` 默认拒绝，错误码 `denied`。单次请求带 `"allow": true`，或把指令名写进 `userData/bus-allow.json` 的 `allow` 数组，才会执行。这个文件不保存 Cookie。`playlist.organize` 同样默认拒绝；即使允许，也返回 `unsupported`，因为当前没有改网易云歌单的接口。

`appearance.write` 只动已有的 `#stage`、`#lyrics`、`#chrome`。`theme` 取 `tide`（默认的青夜）或 `dusk`（暖夜）。`motion` 从 0 到 1，0 停住现有洗色相位，1 是完整摆动。`chromeVisible` 隐藏或显示控件层，`stageLevel` 从 0 到 1 调整洗色不透明度。不会加壁纸或粒子。未知主题名会被拒绝。

```bash
curl -X POST http://127.0.0.1:39272/command \
  -H "Authorization: Bearer <bus-token>" \
  -H "Content-Type: application/json" \
  -d '{"command":"appearance.write","allow":true,"args":{"theme":"dusk","motion":0.4}}'
```

A script talks only to loopback. NetEase calls stay in the existing API process. The bus does not publish NeteaseCloudMusicApi’s route table.

`GET http://127.0.0.1:39272/health` needs no token. `POST /command` needs `Authorization: Bearer` the token in `userData/bus-token`. That file is not a cookie. `ws://127.0.0.1:39272/events?token=` pushes playback and session state. Cookie fields are removed from responses and events.

Playback commands cover get, play, pause, seek, volume, next, previous, queue, and playHits. `playback.volume` changes the live volume and does not write settings. Library reads cover search, playlist tracks, daily, radar, 今日潮汐, and session, plus settings and appearance reads.

`settings.write`, `appearance.write`, `session.logout`, and `session.clearCookie` return `denied` unless the request sets `"allow": true` or `userData/bus-allow.json` lists the command. That file stores no cookie. `playlist.organize` is denied the same way. If it is allowed, the result is `unsupported`, because this app cannot edit a NetEase playlist.

`appearance.write` only changes the existing `#stage`, `#lyrics`, and `#chrome` layers. `theme` is `tide` (the default teal night) or `dusk` (a warm night). `motion` runs from 0 to 1: 0 freezes the existing wash phase, and 1 is the full travel. `chromeVisible` hides the controls. `stageLevel` sets the wash opacity from 0 to 1. There is no wallpaper and no particle system. An unknown theme name is rejected.

## Windows 包 / Windows package

`npm run dist` 用 electron-builder 打一个 Windows x64 zip，里面是 `Tide.exe` 和依赖。不签名。产物在 `release/`，已忽略，不要提交。

`npm run dist:setup` 打 NSIS 安装包。这需要 Windows，或装了 Wine 的机器。这台 Linux 云主机只验证 zip。

The zip is a portable folder, not an installer. Unzip it and run `Tide.exe`. The command bus token is created in `%APPDATA%\tide\bus-token` on first launch. `npm run dist:setup` builds the NSIS installer and needs Windows or Wine.

## 下一步 / Next

继续在 `feat/m1-kernel` 上提交即可。歌词跟唱不在这一版里。不要接 Spotify、QQ，也不要加壁纸或粒子系统。

Keep committing on `feat/m1-kernel`. Synced lyrics are not in this revision. Spotify, QQ, wallpaper, and particle systems stay out.
