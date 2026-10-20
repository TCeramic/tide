# Tide 桌面 UI 测试包验收记录

状态：2026-10-19 桌面预览实现及本轮验收通过，准备本地测试包；不合并或发布正式 release。功能继续复用已有桌面内核，Android、主进程、preload 和核心播放/API 合约未改动。

## 需求与实现

| 需求 | 实现位置 | 验收依据 |
|---|---|---|
| 内容优先的首页，删除重复歌词/足迹卡、散落的小按钮；整卡可点击并支持键盘 | `layers/home.ts`、`desktop-redesign.css` | Lens light 900/1600 与 Lattice dark 1600 人工审阅；全矩阵模块点击与 bounds 断言 |
| 封面保持正方形，提升必要模块高度，避免细长空模块；窄窗口内容可滚动 | `desktop-redesign.css` | 首页封面比例、卡片边界和缩略图可见性检查，首页滚动截图 |
| 最近播放跨启动保留，不局限于当前会话 | `session-history.ts`、`layers/library.ts`、`main.ts` | 最近 100 首真实进入 playing 的歌曲元数据写入 localStorage；恢复、去重、有界与异常存储单元测试；后台播放状态也被记录 |
| 发现音乐展示今日潮汐列表首曲的封面、歌名、歌手，整卡进入同一列表 | `layers/home.ts`、`layers/library.ts` | fixture 首曲封面/文字与点击列表断言；不建立重复推荐数据源 |
| 音乐脉络封面模块显示小型证明树，点击进入原完整模块 | `layers/home.ts` | 首页证明树及原 proof 页面截图与点击检查 |
| 原动态 TIDE 标记跟随首页锚点；导航可折叠，键盘可操作 | `native-shell.js`、`layers/library.ts` | 滚动锚点、展开、方向/Home/End/Escape 验证 |
| 音乐库保留全部歌单、本地音乐标签，搜索与队列保留原功能 | `layers/library.ts`、`view.ts` | 页面截图、原入口点击、返回页面/滚动位置验证 |
| Lattice 自动将歌曲封面绘制为复古纸墨点阵 | `cover-halftone.ts`、`cover-halftone.css` | 按真实图像亮度采样并使用纸墨色；首页/歌词页照片对照人工审阅；CORS 失败保留原封面回退通过 |
| Lens/Lattice、明暗、缩放统一适配；队列/设置浮层可用 | `desktop-redesign.css`、`native-shell.js` | 八组合完整矩阵、队列/设置点击、窗口视口边界与截图 |
| 商籁、凝彩、绘光、花火四类原版 LumiSynth 歌词舞台 | `lyric-stage/`、`vendor/lumisynth/`、`build/lumisynth/entry.ts` | 四 pack Electron 像素 smoke、seek/暂停/非空画面检查；八组合真实 canvas 验证 |
| 舞台延迟加载、失败恢复、语言选项/offset 同步、扩散连续性 | `layers/lyrics.ts`、`theme-stage-preview.ts` | 延迟加载/强制首次失败后重试、原文/双语/罗马音缺失回退、±500ms、切回常规歌词、live canvas mirror 与真实主题扩散验证 |
| 保留逐字多行歌词和小窗播放器现有行为 | 原歌词与小窗实现 | Electron mini smoke 和多行歌词 wrap 回归通过 |

## 数据与兼容边界

最近播放从本轮开始持久化到 renderer localStorage，保留最近 100 首去重记录，只记录歌曲身份、标题、歌手、封面等元数据，不存媒体 URL 或凭据；关闭应用后不再清空。旧版本没有提供的历史数据不能凭空补回。周/月/年收听时长、日历和排行榜没有后端统计来源，因此不编造这些数字，也不把播放队列当作历史。

自动截图使用隔离的合成曲目、歌单、歌词与播放状态 fixture，不读取用户账号、Cookie 或本地媒体。它验证 renderer 的 DOM/CSS、交互和实际 WebGL 像素；真实在线服务、系统文件选择器及音频设备不在浏览器 fixture 覆盖范围。实际 Electron 的舞台、mini 窗口与多行歌词另有原生 smoke 验证。

## 舞台透明度修复

透明舞台出现矩形暗底的根因位于上游共享 vignette shader：混色引入 alpha=1，使透明区域变为不透明黑色。本轮保留输入 `color.a`，仅对预乘 RGB 实施原暗角效果；不关闭暗角，原不透明输出外观等价。修改文件与原因已记录在 `vendor/lumisynth/manifest.json`。四 pack Electron smoke 在这项修复后重新通过，主题扩散截图人工确认矩形暗底消除。

舞台采用原 LumiSynth 四 pack 渲染算法，Tide 当前播放时间驱动原 Pixi kernel；没有独立计时器，不提前跳回第一句。引擎仅在选择舞台时加载，隐藏/退出按生命周期释放。官方 `pixi.js/unsafe-eval` 提供静态 eval-free 实现，应用 CSP 没有放宽。

## 验收记录

| 检查 | 本轮结果 |
|---|---|
| `npm run verify:design-systems` | 70 个原版文件哈希通过 |
| `npm run typecheck` | 通过 |
| `npm test` | 175 项通过 |
| `npm run build` | 通过，含最终纸墨 CSS、舞台 alpha 修复 |
| `node scripts/desktop-redesign-smoke.cjs` | 最终重跑通过：99 张 PNG、8/8 stage canvas、8/8 首页 bounds、无 pageErrors、CORS 回退通过 |
| 四 pack Electron stage smoke | 最终 shader 修复后重跑通过：非空、seek 像素变化、暂停稳定、无 consoleErrors |
| Electron mini smoke | 通过 |
| 多行歌词 wrap 回归 | 通过 |
| theme-stage-preview helper smoke | snapshot/live frame/dispose/fallback 通过 |
| 主线程人工视觉复查 | Lens light 900/1600 首页、Lattice dark 1600 首页、纸墨封面与最终舞台扩散通过 |

截图根目录 `artifacts/desktop-redesign-smoke/`：Lens/Lattice × light/dark × 900x650/1600x1000。每组覆盖 home、home-scroll、explore、library-playlists、library-local、search、footprint、proof、queue、settings、playing、lyric-stage，另有 CORS、首次加载失败回退与舞台扩散补充截图。完整记录见 `screenshots.json`。Browser plugin 不可用，使用现有 Playwright/Edge 执行。

## 交付说明

最终完整 ZIP 已生成（188.4 MiB），对应源码 ZIP 9.1 MiB。已逐项核对 724 个源码文件 SHA256 与当前接受的源码一致，并从打包 app.asar 读出 renderer、舞台 bundle、两份新增 CSS 和 AGPL 许可证与 dist 比对一致。Windows 路径使用 path.normalize 读取 asar 条目。

打包 EXE 使用独立 TIDE_USER_DATA 和端口完成 native smoke；首次透明小窗停帧断言观测到 1 个已排队帧（期望 0），同一包原样复测通过全部原生检查。该计时敏感现象已记录，未通过改动产品或放宽断言掩盖。原稳定版进程未退出。

本地预览包输出至 `release/desktop-ui-preview-20261019/`，包括完整 Windows x64 ZIP、对应源代码 ZIP、SHA256 校验与中文说明。沿用内部版本 1.0.2，外部文件名明确标为 Preview，不覆盖稳定版安装目录，不发布正式 release。

舞台入口：播放页右上角「…」→「歌词舞台」→ 商籁 / 凝彩 / 绘光 / 花火。需要常规歌词时选择常规项。

对应源码包含 Tide GPL-3.0-only 及 LumiSynth AGPL-3.0-only 源码、修改说明、依赖锁定和构建脚本。测试包以独立配置/端口进行启动验证，不退出或操作用户正在运行的 `D:\Tide\Tide.exe`。
