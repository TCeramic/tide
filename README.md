# 潮汐 Tide

潮汐是一个 **Windows 优先** 的个人桌面音乐播放器（Electron）。当前是 **0.9.1**。窗口外壳可切换透镜和点阵，直接使用 MIT 上游源码。透镜有真实折射、厚润材质和弹性控件；点阵有 GPU 点集、形态变换与点阵控件。可选的播放层点阵开关仍独立保留。图标来自 Lucide。点歌单名称会载入曲目，不会自动开播；今日潮汐 · 探索用听过的歌去找相似歌曲；播放队列可以列表循环、单曲循环、顺序或随机，并在探索打开时用相似歌曲续上。搜索分成单曲、歌手、专辑、歌词。每首歌有封面、播放、下一首、喜欢、收藏和分享。点一行只选中，双击或「开始播放」才开播。歌词层默认把原文和翻译叠在一起，逐字扫过停在字内。桌面歌词是单行沉浸，译文和字后波形可选。设置里有热键、字体、性能档、桌面歌词和点阵开关。指令总线可以在窗口里找到。写设置仍要明确允许。

Tide is a **Windows-first** personal desktop music player. This revision is **0.9.1**. The shell switches between the original MIT Lens and Lattice systems: native refraction and elastic controls, or GPU point sets and dot controls. The optional playback point layer remains a separate switch. Icons are Lucide. Opening a playlist loads tracks and does not start playback. 今日潮汐 · 探索 finds similar songs from what you have heard. The queue can repeat, play straight through, shuffle, and keep going from similar songs. Search has song, artist, album, and lyric tabs. Each song row shows cover art and can play, queue next, like, collect, and share. A single click selects; double-click or 开始播放 starts playback. Lyrics default to original plus translation, with an in-glyph sweep. Desktop lyrics are one immersive line; a translation and a rear wave are optional. Settings hold hotkeys, fonts, a performance tier, desktop lyrics, and the lattice switch. The command bus is reachable from the window. Settings writes still need an explicit allow.

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
{ "ok": true, "service": "tide", "version": "0.9.1" }
```

`npm test` 跑状态机、搜索结果整理、今日潮汐排序、收听日志、指令总线、Cookie 判断和登录 / 搜索路由。`npm run typecheck` 只做类型检查。

## 登录 / Login

左侧「登录网易云」面板有两条路，扫码需要手机上的网易云音乐：

1. **扫码。** 点「显示二维码」，用网易云 App 扫码并在手机上确认。二维码过期就再点一次。
2. **粘贴 Cookie。** 从已登录的网页版复制请求头里的 Cookie，贴进输入框，点「保存 Cookie」。内容里必须有 `MUSIC_U`，否则会被拒绝。

登录成功后，面板列出账号昵称和歌单（名称与曲数）。点一个歌单名称会按页载入曲目（大约到 2000 首或列表结束），并写明已载数量，不会自动开播。再点能播的一行，才从那一首开始播放。点「返回」可以收起，再打开另一张歌单。搜索不依赖登录。「今日潮汐 · 探索」也不依赖登录：没有收听记录时会说明原因。登录后，没听过的部分优先用相似歌曲（`simi_song`），种子来自听过的歌，听得少时也可以用来自「喜欢的音乐」的曲目做种子。相似歌曲不够时，每日推荐只补剩余的一小段，不是和私人雷达做一对一混合。歌单名常常是「昵称喜欢的音乐」，不一定是「我喜欢的音乐」。每日推荐和私人雷达仍是单独入口，需要登录；账号拿不到时会写明原因。部分曲目仍会因为版权、地区或会员限制没有地址。

Cookie 写在 Electron `userData` 目录的 `netease.cookie`（Windows 上一般是 `%APPDATA%/tide/netease.cookie`）。Unix 上文件权限是 `0600`。`.gitignore` 已忽略 `*.cookie` 和 `userData/`。

点「退出登录」会删掉这个文件。如果保存的 Cookie 已失效，面板会写明「登录已失效，请重新登录」，可以扫码、粘贴新 Cookie，或点「清除登录」。

The left panel accepts a NetEase QR login or a pasted cookie that contains `MUSIC_U`. After login it lists your playlists. Opening a name loads its tracks in pages and does not start playback. Choosing a playable row starts there. The cookie is stored only in Electron userData as `netease.cookie`. Logout deletes it. An invalid cookie asks you to log in again. Search works without a cookie. **今日潮汐 · 探索** does too: an empty listen log explains itself. Unheard tracks come from `simi_song`, seeded by plays or by the liked playlist when the log is thin. Daily recommendations may fill only a short remainder. That playlist is often named **昵称喜欢的音乐**, not only **我喜欢的音乐**. Daily recommendations and 私人雷达 stay separate entries and need a login. Some tracks still have no URL because of region, copyright, or membership limits.

完成一次真实扫码需要能打开网易云 App 的手机，开发机上不一定能代点确认。

## 目录 / Layout

```
src/main/                 窗口；API 子进程；退出时清理；登录与播放 IPC
src/preload/              contextBridge（window.tide）
src/core/events.ts        事件总线
src/core/playback/        idle / loading / playing / paused / error
src/core/tide-today.ts    听过的歌，加上 simi_song 相似歌曲
src/core/explore-queue.ts 队列快结束时用相似歌曲续上
src/core/lyrics.ts        LRC 全文和当前句
src/renderer/             #stage 动效层、#lyrics 歌词层、#chrome 控件、搜索与歌单
src/renderer/player.ts    窗口里的 audio 元素
src/renderer/clock.ts     requestAnimationFrame 时钟
src/api/server.ts         127.0.0.1 上的 /health、/session、/search、/playlist/tracks、/similar、/lyric
src/api/netease.ts        只调用 NeteaseCloudMusicApi 的登录、歌单、搜索、相似、歌词和歌曲地址
src/main/settings.ts      userData/settings.json，音量、主题、动效、控件显隐、舞台强度
src/main/listen-log.ts    userData/listen-log.json，不含 Cookie
src/shared/commands.ts    指令名称、危险操作和响应清洗
src/main/command-server.ts 127.0.0.1 上的指令 HTTP / WebSocket
```

## 搜索和播放 / Search and playback

左侧搜索分成四个页签：单曲、歌手、专辑、歌词（对应类型 1、100、10、1006）。单曲和歌词的结果是可以播放的歌曲。点歌手或专辑会打开另一张列表，带「返回」。每一行有播放和喜欢的快捷图标，以及菜单：播放、下一首播放、喜欢、收藏到…、分享链接。没登录时，喜欢和收藏会写明失败原因。灰色行写着「没有可播放的地址」。

底部上一首、播放 / 暂停、下一首和音量是图标，带中文 `aria-label`。旁边留着列表循环、随机和探索。默认是列表循环。探索打开后，剩下不多于 3 首时会用当前和最近几首去要相似歌曲（`simi_song`），接到队列后面。关掉探索就不再追加。相似歌曲没拉到时会有提示。默认不显示「本地 API · 端口」；「指令总线」里可以打开。

地址由本地 API 向网易云申请，只接受 `http` / `https`。申请失败时播放器停住，并写明「没有可播放的地址」或「请先登录」。Cookie 只留在主进程的 userData 里，不会进播放器快照，也不会交给页面保存。同目录的 `settings.json` 存音量、主题、动效、控件显隐、舞台强度、热键和桌面歌词，不存 Cookie。

歌单按 `playlist_track_all` 的 offset 翻页，到空页或大约 2000 首为止。灰色曲目留在列表里，但不会进入队列。列表循环会回到第一首；顺序播放停在最后一首；单曲循环重复当前这一首。

## 喜欢 / Liked songs

列表、播放队列和底栏当前曲的心形来自网易云 `likelist`（`/api/song/like/get` 返回的歌曲 id）。登录后潮汐拉这份 id 列表，再标到每一行上。没有 Cookie 时没有这份列表，心形保持空心，不会把所有歌假装成未喜欢以外的状态；接口返回里若单曲自己带了 `liked: true`，会先按那个提示显示。点喜欢或取消喜欢成功后，界面改成接口确认的结果。取消喜欢传给 `like` 的仍是字符串 `"false"`。

Hearts on the list, the queue, and the current track follow NetEase `likelist`. Without a cookie there is no list, so hearts stay hollow unless a song payload already says `liked: true`. A successful toggle updates the heart to the value the API confirmed. Unlike still sends the string `"false"`.

## 桌面歌词 / Desktop lyrics

设置里的「桌面歌词」打开一个独立的透明置顶窗口，关掉就销毁，不留常驻窗口。解锁时可以拖，位置会记住，默认不吸附屏幕边缘。锁定后点击穿透到下层，用 `Ctrl+Alt+L` 锁定或解锁（不靠中键，避免把点击抢回来）。字号、字色和透明度可以改。当前行用整行高亮和一段上移动效。有翻译时在原文下面加一行，没有翻译就不留空行。主窗口最小化时，主进程仍按播放进度刷新这扇窗口。窗口落在已经拔掉的屏幕上时，会回到主屏可见区域。字边只用很细的浅色阴影，不把字心涂脏。

Desktop lyrics are a separate transparent always-on-top window. Turning them off destroys that window. Unlocked, the window can be dragged and the point is saved, with no magnetic snap. Locked, clicks pass through; `Ctrl+Alt+L` locks or unlocks. Font size, color, and opacity are adjustable. The current line is highlighted. A translation sits under the original when one exists. The overlay keeps moving while the main window is minimized.

## 热键 / Hotkeys

罗技 G HUB、Options+ 一类驱动通常发出系统媒体键（`VK_MEDIA_NEXT_TRACK`、`VK_MEDIA_PREV_TRACK`、`VK_MEDIA_PLAY_PAUSE`、`VK_MEDIA_STOP`）或 `WM_APPCOMMAND`。潮汐对这四件事各做一次：下一首、上一首、播放/暂停、停止。

0.8.1 在 Windows 上只靠 `navigator.mediaSession`。Electron 里这条通道在窗口失焦、最小化、或还没有任何曲目开始播放时收不到硬件键（还没有系统媒体会话，Chromium 也只在聚焦窗口里看到这些消息）。0.8.2 在「热键」里加了「接管系统媒体键」，默认打开。0.8.3 起这一组放在左侧「设置」里。打开时注册四个全局媒体键，覆盖这三种状态；关掉后不再注册，其它播放器可以继续接收这些键。旁边写着「会抢占其他播放器的媒体键」。开关会立刻注册或注销。Media Session 和自定义组合键不受这个开关影响。窗口聚焦时另外只监听 `app-command`（不再同时挂钩 `hookWindowMessage`）。同一个动作若在约 300 毫秒内从另一个来源再来一次，会被丢掉；同一个来源连按两次都会执行。

在 G HUB 或 Options+ 里：

1. 把可编程键设成媒体功能：下一首、上一首、播放/暂停、停止。同一个物理键不要再绑第二条宏。若这些键还要留给 Spotify 或浏览器，把「接管系统媒体键」关掉。
2. 驱动如果只能发普通组合键，就设成例如 `Ctrl+Alt+Right`（下一首）、`Ctrl+Alt+Left`（上一首）、`Ctrl+Alt+Space`（播放/暂停）、`Ctrl+Alt+Down`（停止），或 `Ctrl+Shift+F13` 这种 F13–F24。然后在潮汐左侧打开「设置」里的「热键」，填入同一组组合并保存。组合无效或和另一项重复时会有红色说明。`globalShortcut.register` 失败时退回上一个已经生效的组合，并写明「已被占用」。
3. 一个物理键只对应一个动作。不要把系统媒体键和自定义组合同时绑在同一个键上。

**Windows 真机验证仍待完成。** 开发环境不能替一台 Windows 机器按下罗技键或 `VK_MEDIA_*`。

Logitech G HUB and Options+ usually send a media virtual key or `WM_APPCOMMAND`. Tide maps next, previous, play/pause, and stop. **接管系统媒体键** defaults to on and registers the four media keys; turn it off to leave them for other players. Media Session, the focused-window `app-command` path, and custom combos stay either way. A second delivery of the same action from another source inside about 300ms is dropped; two presses from one source both run. Custom combos accept F13–F24. If a new combo cannot be registered, Tide puts the previous working combo back. **A real Windows machine still has to confirm this.**

## 歌单和推荐 / Playlists and recommendations

登录后点左侧歌单名称只载入列表。点「每日推荐」或「私人雷达」仍会开始播放，这是单独的官方入口。私人雷达来自官方每日推荐歌单里名称包含「私人雷达」的那一张，再用歌单曲目接口取出歌曲。账号没有这张歌单时，面板写「这个账号暂时没有私人雷达」。未登录时这两个推荐入口会提示先登录。

After login, a playlist name only loads the list. **每日推荐** and **私人雷达** still start playback. 私人雷达 is the official daily playlist whose name contains that title. If the account has no such playlist, the panel says so. Signed-out recommendation requests ask you to log in first.

## 今日潮汐 / Tide today

「今日潮汐 · 探索」在搜索下面，和「推荐」里的每日推荐、私人雷达分开。点「查看探索」只列出曲目，不会自动开播；再点能播的一行，才会进队列并播放。灰色行仍然禁用。

听过的部分来自本机 `userData/listen-log.json`：不到 30 秒就切到后面的曲子算跳过。播完自然进入下一首不算跳过。文件里只有曲目编号、标题、歌手、时长、时间和播放或跳过，没有 Cookie。

没听过的部分调用 NeteaseCloudMusicApi 的 `simi_song`。种子是最近听过的歌；听过的歌不够、并且已经登录时，种子改用喜欢歌单里的前几首，喜欢歌单本身不会整张倒进列表。相似歌曲不足 8 首时，才用 `recommend_songs`（每日推荐）补剩余名额。私人雷达不参与这张列表。相似歌曲请求失败时，界面会写明。

喜欢歌单仍优先 `specialType` 5，其次「昵称喜欢的音乐」或「我喜欢的音乐」。

**今日潮汐 · 探索** sits under search, apart from **每日推荐** and **私人雷达**. **查看探索** lists tracks and does not start playback. Heard tracks come from the local listen log. Unheard tracks come from `simi_song`. Daily songs fill only a short remainder, and 私人雷达 is not mixed in.

Search has four tabs. A playable row starts at that song. A gray row says it has no URL.

The bar uses icons for previous, play or pause, next, and volume. Repeat defaults to the whole list. Explore appends `simi_song` results when three or fewer tracks remain. The API port line stays hidden unless the in-window bus panel turns it on.

The loopback API asks NetEase for a URL and accepts only `http` / `https`. If that fails, playback stops with “no URL” or “sign in first”. The cookie stays in the main-process userData file. It is not part of the playback snapshot and the page does not store it. `settings.json` stores volume, the theme, motion strength, whether the controls are visible, and the stage strength. It does not store the cookie.

## 指令总线 / Command bus

外部脚本只连本机。网易云接口仍由原来的 API 子进程处理，指令总线不挂出 NeteaseCloudMusicApi 的全部路由。

- `GET http://127.0.0.1:39272/health` 不需要令牌，返回 `tide-bus` 和版本。
- `POST /command` 需要请求头 `Authorization: Bearer <令牌>`。令牌在 `userData/bus-token`，64 位十六进制，权限 `0600`。这不是 Cookie。
- WebSocket `ws://127.0.0.1:39272/events?token=<令牌>` 推送播放和会话状态。响应和推送里不会出现 Cookie。

窗口左侧「指令总线」可以展开，里面有端口说明、令牌路径、示例，以及播放和暂停。底栏默认不显示端口。

播放指令有 `playback.get`、`play`、`pause`、`seek`、`volume`、`next`、`prev`、`queue`、`playHits`、`playback.mode`。`playback.mode` 可以改 `repeat`（`off` / `all` / `one`）、`shuffle` 和 `explore`，不需要 allow。`playback.volume` 只改当前音量，不写盘。只读指令有 `library.search`、`playlistTracks`、`daily`、`radar`、`tideToday`、`session`，以及 `settings.read`、`appearance.read`。

`settings.write`、`appearance.write`、`session.logout`、`session.clearCookie` 默认拒绝，错误码 `denied`。单次请求带 `"allow": true`，或把指令名写进 `userData/bus-allow.json` 的 `allow` 数组，才会执行。这个文件不保存 Cookie。`playlist.organize` 同样默认拒绝；即使允许，也返回 `unsupported`，因为当前没有改网易云歌单的接口。

`appearance.write` 只动已有的 `#stage`、`#lyrics`、`#chrome`。`theme` 取 `tide`（默认的青夜）或 `dusk`（暖夜）。`motion` 从 0 到 1。`lattice` 是可选点阵。`shell` 取 `lens`（默认）或 `lattice`。`preset` 取 `tide`、`cover-glow`、`vinyl`、`stardust`、`quiet`。`performance` 取 `smooth`、`balanced`、`vivid`。`background` 取 `solid`、`cover`、`image`。未知名字会被拒绝。

```bash
curl -X POST http://127.0.0.1:39272/command \
  -H "Authorization: Bearer <bus-token>" \
  -H "Content-Type: application/json" \
  -d '{"command":"appearance.write","allow":true,"args":{"theme":"dusk","motion":0.4}}'
```

A script talks only to loopback. NetEase calls stay in the existing API process. The bus does not publish NeteaseCloudMusicApi’s route table.

`GET http://127.0.0.1:39272/health` needs no token. `POST /command` needs `Authorization: Bearer` the token in `userData/bus-token`. That file is not a cookie. `ws://127.0.0.1:39272/events?token=` pushes playback and session state. Cookie fields are removed from responses and events.

The left panel has a **指令总线** disclosure with the port, the token path, an example, and play / pause. The footer hides the port by default.

Playback commands cover get, play, pause, seek, volume, next, previous, queue, playHits, and `playback.mode` (`repeat`, `shuffle`, `explore`). Mode does not need allow. `playback.volume` changes the live volume and does not write settings. Library reads cover search, playlist tracks, daily, radar, 今日潮汐, and session, plus settings and appearance reads.

`settings.write`, `appearance.write`, `session.logout`, and `session.clearCookie` return `denied` unless the request sets `"allow": true` or `userData/bus-allow.json` lists the command. That file stores no cookie. `playlist.organize` is denied the same way. If it is allowed, the result is `unsupported`, because this app cannot edit a NetEase playlist.

`appearance.write` only changes the existing `#stage`, `#lyrics`, and `#chrome` layers. `theme` is `tide` or `dusk`. `shell` is `lens` (default) or `lattice`. `preset` is `tide`, `cover-glow`, `vinyl`, `stardust`, or `quiet`. `performance` is `smooth`, `balanced`, or `vivid`. `background` is `solid`, `cover`, `image`, or `paper`. `lattice` toggles the optional dot field. An unknown name is rejected.

## Windows 包 / Windows package

`0.9.2-test.3` 重建透镜适配层，保留原版 Lens 光学与组件；逐字歌词改为真实音频时钟逐帧驱动，删除歌词页半透明底板，选歌只播放而不跳转。界面文字不再被拖动选中，指针保持箭头，按钮/标签提供悬停和选中反馈。

`0.9.2-test.2` 修复透镜设置滚动、队列自动隐藏、长歌名挤动按钮和今日潮汐封面；加长进度条并显示拖动时间。新增逐字歌词与跟随交互、AMLL TTML 回退、Pretext 测量和 Paper 流动背景。无密钥可用本地封面配色；AI 自动调用接口与手动 JSON 导入已完成，尚未调用真实模型。来源、使用方法及验证边界见 [适配说明](docs/UPSTREAM_ADAPTATIONS.md)。

`0.9.2-test.1` 修正点阵卡片文字边界，统一面板与占位封面背景；「添加本地音乐」移动到主页「本地音乐」子菜单。歌曲缺失封面时批量查询详情补齐，专辑搜索和专辑曲目保留封面，网易云 HTTP 图片升级为 HTTPS；图片失败后短暂回退占位，避免永久屏蔽。

`npm run dist` 用 electron-builder 打一个 Windows x64 zip，里面是 `Tide.exe` 和依赖。不签名。产物在 `release/`，已忽略，不要提交。

`npm run dist:setup` 打 NSIS 安装包。这需要 Windows，或装了 Wine 的机器。本次在 Windows 验证 portable ZIP。

The zip is a portable folder, not an installer. Unzip it and run `Tide.exe`. The command bus token is created in `%APPDATA%\tide\bus-token` on first launch. `npm run dist:setup` builds the NSIS installer and needs Windows or Wine.

## 外壳 / Shell

## 原版设计系统 / Original design systems

透镜与点阵直接复用 [design-systems](https://github.com/ruiqichenbiec/design-systems) 的 MIT 源码，固定提交 `7a424c93b9be13cf835b91ea67495fec2ec0584e`。上游 70 份文件保持原样，`npm run verify:design-systems` 逐个核对 Git blob SHA。许可、来源与文件清单在 `src/renderer/vendor/design-systems/`。后续 UI 优先直接用上游组件，项目约定见 `AGENTS.md`。

设置 → 设计系统 → 透镜 / 点阵即时切换。透镜使用原版 GlassRenderer、JellyController、厚润材质、背景画面、胶囊选择与音效。点阵使用原版 GPU Field、点集生成器、点阵标签、滑杆和数字，可切换文字、Lorenz 吸引子、三叶结、晶格与 Klein 瓶；按住背景熔化，松开重组。播放器业务布局和事件仍由 Tide 绑定，弹出面板使用独立的原版透镜 stage，避免对底层 DOM 进行假折射。WebGL 缺失时保留原版 DOM 控件和 CSS 材质。

两颗「完整组件」按钮打开上游原版完整互动展示，含透镜 18 类和点阵 14 类组件；展示页在独立沙箱 iframe 中运行，没有 Electron bridge。序曲尚未加入预设。播放层点阵开关仍是独立选项。

`npm run test:ui` 用 Playwright + IPC fixture 验证渲染器和两套组件展示。需要可用的 `playwright` 模块（或通过 `TIDE_PLAYWRIGHT_MODULE` 指向现有模块），Windows 默认使用已安装的 Edge。截图在 `artifacts/ui-smoke/`，不写入 Git。此检查不替代 Electron 原生窗口、真实登录与音频验收。

`npm run test:native` 启动真实 Electron，使用独立临时 userData、随机端口和软件 WebGL，检查窗口、API、点阵、本地音乐导入和静音 WAV 播放。文件选择器用确定性返回值替代，文件索引、IPC、API 和音频播放链路均实际运行。可设置 `TIDE_TEST_EXE` 为打包后的 `Tide.exe`；截图在 `artifacts/native-smoke/`。该检查不覆盖真实账号登录、云端音频权限或硬件媒体键。

The Lens and Lattice presets use the actual MIT upstream renderers and components, not approximate recreations. The original showcase sources are retained intact and accessible from Settings. The packaged Lattice page replaces blocking Google Fonts requests with embedded original Latin faces; both pages are isolated from Electron IPC.


0.9.0 把 `#stage`、`#lyrics`、`#chrome` 画成透镜：玻璃承载侧栏、免责声明和底栏，液体是舞台上的连续洗色，光标出正在播放和当前歌词。WebGL2 折射可选；打不开或太慢就只留 CSS。点阵在底栏和「设置」里开关，默认关，只在播放时轻轻动，不代替窗口本身。序曲没有用在这里。

玻璃与弹簧的想法来自 [Lens](https://github.com/ruiqichenbiec/design-systems)（Copyright (c) 2026 DayDreamInAReverie，MIT，仓库已不再维护）。早期版本只改编了这个想法；当前透镜与点阵直接复用上游原版源码。图标是 [Lucide](https://lucide.dev)（ISC），和 lucide-react 同一套字形；壳层不是 React，所以用 vanilla `lucide`。

`appearance.write` 可以改主题、动效、控件显隐、舞台强度、点阵开关、外壳（`lens` / `lattice`）、视觉预设、性能档、字体和背景。点阵默认关。写盘仍要 `allow`。性能档会改 WebGL、点阵数量、模糊和桌面歌词的远光。0.9.1 的主页只留常用卡片，证明树用 Lattice 的 ProofTree，桌面歌词由主进程给出进度、覆盖层只画。

`appearance.write` persists theme, motion, chrome, stage level, lattice, shell (`lens` or `lattice`), preset, performance, font, and background. A performance tier changes WebGL, lattice density, blur, and the desktop-lyric far glow. 0.9.1 keeps the home to the common cards, mounts the Lattice ProofTree, and lets the player compute lyric progress while the overlay only paints.

0.9.0 redraws the three layers as Lens glass. Liquid is the stage wash. Light marks the playing state. WebGL2 refraction is optional and falls back to CSS. Lattice toggles from Settings, stays off until asked, and is not the shell. `appearance.write` persists `lattice`, `shell` (`lens` or `lattice`), `preset`, `performance`, and `background`. Overture is not used. The glass and spring ideas are adapted from Lens (Copyright (c) 2026 DayDreamInAReverie, MIT); this revision directly vendors the original implementation with its MIT notices. Icons are Lucide.

## 下一步 / Next

不要接 Spotify、QQ，也不要把 Grok 嵌进窗口。透镜与点阵外壳继续直接复用上游。

Spotify, QQ and an embedded Grok client stay out. Lens and Lattice remain original upstream systems.
