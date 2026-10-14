# 更新记录 / Changelog

## 0.8.3

- 底栏上一首、播放/暂停、下一首和音量改成看得见的图标按钮。底栏不再显示「本地 API」。
- 歌词默认原文和翻译叠在一起。还可以只看原文、只看翻译或罗马音。「偏移量」收进折叠区。
- 喜欢状态读取网易云 `likelist`。列表、队列和当前曲的心形按真实 id 点亮。取消喜欢仍传字符串 `"false"`。
- 「可编程按键」改名为「热键」，放进「设置」。系统媒体键接管开关也在这里。
- 桌面歌词：独立透明置顶窗口，关掉即销毁。解锁可拖，锁定后点击穿透，`Ctrl+Alt+L` 锁定或解锁。可调字号、字色、透明度。当前行高亮。有翻译时双行显示。主窗口最小化时仍刷新。不默认磁吸。
- Windows 图标换成官方深海波浪标，含 256、128、64、48、32、16。小尺寸加粗了高光。
- 健康检查版本为 `0.8.3`。

Bottom-bar icons stay visible. Lyrics default to original plus translation. Liked hearts follow `likelist`. Hotkeys live under Settings. Desktop lyrics are an optional always-on-top overlay. The Windows icon is the official wave mark. Health is `0.8.3`.

## 0.8.2

- 硬件媒体键（下一首、上一首、播放/暂停、停止）在窗口失焦、最小化、以及还没播放过时也会生效。Windows 上除了 `navigator.mediaSession`，还可以接管四个系统媒体键；聚焦窗口只走 `app-command` 这一条 `WM_APPCOMMAND`。
- 「可编程按键」里的「接管系统媒体键」默认打开。关掉后不再用 `globalShortcut` 注册这四个键，Spotify 和浏览器可以继续用它们。Media Session、`WM_APPCOMMAND` 和自定义组合键仍然有效。开关立刻注册或注销。旁边注明「会抢占其他播放器的媒体键」。
- 同一次按键若从另一个来源在约 300 毫秒内再到达，只执行一次。同一个来源连按两次都会执行。
- 「可编程按键」可保存额外组合键（例如 `Ctrl+Alt+Right`，也接受 `F13`–`F24`），给只能发普通按键的罗技 G HUB / Options+。注册失败时退回上一个还能用的组合，并写明原因。
- **Windows 真机验证仍待完成。** 本环境不能按下 `VK_MEDIA_*` 或罗技驱动发出的 `WM_APPCOMMAND`。
- 健康检查版本为 `0.8.2`。

Hardware media keys keep working when the window is unfocused, minimized, or idle. One press runs one action. Custom shortcuts can stand in for drivers that only send ordinary combos. A real Windows machine still has to confirm the keys.

## 0.8.1

- 播放队列可以查看、移除、拖动或上下移动、清空。
- 系统媒体键（播放/暂停、上一首、下一首）和窗口里的 Media Session 走同一套播放命令。Windows 只走 Media Session，其它系统只走全局快捷键，一次按键只触发一次。
- 收藏时读取 `playlist_tracks` 嵌套的 `body.body.code`。502（「歌单内歌曲重复」）提示「已在歌单中」；其它非 200 提示收藏失败。
- 歌词可以在原文、翻译、罗马音之间切换，并按 0.5 秒调整偏移。翻译和罗马音来自 `lyric` 的 `tlyric` 与 `romalrc`。
- 私人 FM 使用 `personal_fm`。不喜欢使用 `fm_trash`，然后从队列拿掉当前这首。
- 音质选择走 `song_url_v1` 的 level（标准、极高、无损、Hi-Res）。选中的档位没有地址时会降到更低档，并写明原因。
- 读取登录状态时调用 `login_refresh`。Cookie 过期会显示「登录已过期，请重新扫码或粘贴 Cookie。」，不会假装仍然登录。
- 健康检查版本为 `0.8.1`。

Queue editing, media keys, lyric variants, personal FM, audio quality, and a visible expired-login prompt.

## 0.8.0

- 点歌单名称只载入曲目，显示已载数量，不自动播放。点能播的一行才从那一首开始。`playlist_track_all` 按 offset 翻页，到空页或大约 2000 首。
- **今日潮汐 · 探索**：听过的来自本地收听日志；没听过的来自 `simi_song`。相似歌曲不足 8 首时，`recommend_songs` 只补剩余名额。私人雷达不进入这张列表。相似歌曲失败时有说明。列表不自动播放。
- 播放模式：顺序、列表循环（默认）、单曲循环、随机。`playback.mode` 不需要 allow。
- 探索打开时，队列剩余不多于 3 首就用当前和最近几首调用 `simi_song` 追加。关掉就停止。失败有提示。不把每日推荐整表接上。
- 底栏上一首、播放 / 暂停、下一首、音量改为图标，`aria-label` 为中文。列表循环、随机、探索留在同一条栏上。
- 歌词层拉取 `lyric`，显示全文，当前句随进度变化。没有歌词不会把窗口弄崩。换曲后旧歌词不会套到新曲上。
- 搜索四个页签：单曲、歌手、专辑、歌词（类型 1 / 100 / 10 / 1006）。点歌手或专辑打开另一张列表，可以返回。歌词页签的结果是可播歌曲。
- 歌曲行菜单：播放、下一首播放、喜欢、收藏到…、分享链接。播放和喜欢有行内图标。未登录或失败会写明原因。喜欢用 `like`，收藏用 `playlist_tracks`。
- 窗口里可以展开「指令总线」。底栏「本地 API · 端口」默认隐藏。
- 取消喜欢传给 `like` 的是字符串 `"false"`。`playlist_tracks` 返回 502（已经在歌单里）时提示「已在歌单中」。
- 健康检查版本为 `0.8.0`。NeteaseCloudMusicApi 仍是 `4.32.0`。要求 Node.js `>=22`。

Playlists load without autoplay. 今日潮汐 · 探索 and queue continuation use `simi_song`. Search, lyrics, track menus, icon transport, and a discoverable command bus land in this revision. Health is `0.8.0`.

## 0.7.0

- 两套主题：`tide`（青夜，默认）和 `dusk`（暖夜）。只改现有 `#stage`、`#lyrics`、`#chrome` 的颜色和洗色。
- `motion` 从 0 到 1，控制同一条洗色相位。0 停住，1 是完整摆动。`stageLevel` 仍是洗色不透明度，`chromeVisible` 仍是控件显隐。
- `appearance.read` / `appearance.write` 覆盖主题和动效。写盘仍要请求里的 `allow`，或 `userData/bus-allow.json`。未知主题返回参数错误，不会落盘。
- `settings.json` 增加 `theme` 和 `motion`。旧文件缺这两个字段时按 `tide` 和 `1` 打开，外观与上一版相同。文件里仍然没有 Cookie。
- `npm run dist` 用 electron-builder 打 Windows x64 zip（`Tide.exe`）。`npm run dist:setup` 打 NSIS 安装包，需要 Windows 或 Wine。
- 健康检查版本为 `0.7.0`。NeteaseCloudMusicApi 仍是 `4.32.0`。

Two themes, `tide` and `dusk`, recolor the existing layers. `motion` scales the existing wash phase. Appearance writes stay behind the command-bus allow list. `npm run dist` builds a Windows x64 zip.

## 0.6.0

- 本机指令总线：`127.0.0.1:39272` 的 `POST /command`，令牌在 `userData/bus-token`。`GET /health` 不需要令牌。
- WebSocket `/events` 推送播放和会话状态。响应、推送和日志里不出现 Cookie。
- 播放、设置读取、歌库只读（搜索、歌单、每日推荐、私人雷达、今日潮汐、会话）走已有主进程和 API 子进程。
- `settings.write`、`appearance.write`、`session.logout`、`session.clearCookie`、`playlist.organize` 默认拒绝。允许后的 `playlist.organize` 返回 `unsupported`。
- `playback.volume` 只改当前音量，不写 `settings.json`。
- `appearance.write` 可以隐藏控件层，并调整洗色强度。

Loopback command bus for playback and library reads. Dangerous writes require an explicit allow. Playlist edits are unsupported.

## 0.5.0

- **今日潮汐** 用 `userData/listen-log.json` 的播放和跳过记录排序，不调用网易云推荐接口。
- 不足 5 首不同播放时，用已登录账号的喜欢歌单补足。优先 `specialType === 5`，其次「昵称喜欢的音乐」或「我喜欢的音乐」。
- **查看今日潮汐** 只列出曲目。点能播的行才会排队播放。没有收藏按钮。
- 未登录时空列表仍提示登录后再补。已登录但没匹配到时，不再提示去登录。

今日潮汐 ranks the local listen log. A thin log can be filled from the personal liked playlist.

## 0.4.0

- 已登录歌单载入同一条播放队列，从第一首能播的开始，结束后自动下一首。
- **每日推荐** 使用 `recommend_songs`。**私人雷达** 使用官方日推歌单名，再取曲目。
- 音量写入 `userData/settings.json`。文件里没有 Cookie。

Playlists, daily recommendations, and 私人雷达 share the playback queue. Volume is saved locally.

## 0.3.0

- 搜索结果可以点播放。能播的行进入队列；没有地址的行是灰色的，不能选。
- 暂停、继续、拖动进度、音量、上一首、下一首。
- 歌曲地址只接受 `http` / `https`。Cookie 不进入播放快照，也不交给页面。

Search plays real audio. Unplayable rows stay disabled.

## 0.2.0

- 扫码或粘贴带 `MUSIC_U` 的 Cookie 登录。Cookie 只写在 `userData/netease.cookie`。
- 登录后列出歌单。退出登录会删除 Cookie。失效的 Cookie 会提示重新登录。
- NeteaseCloudMusicApi 钉在 `4.32.0`，只从 `src/api` 调用，不挂出它的全部路由。

QR or cookie login. The cookie stays in userData and never reaches the renderer.

## 0.1.0

- Electron 窗口，`#stage` / `#lyrics` / `#chrome` 三层。
- 播放状态机，以及只监听 `127.0.0.1` 的 API 子进程。`GET /health` 报告版本。

Electron window, playback state machine, and a loopback API child.
