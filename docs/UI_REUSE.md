# 原版透镜 / 点阵接入验收

2026-10-16。上游：https://github.com/ruiqichenbiec/design-systems 。
固定提交：`7a424c93b9be13cf835b91ea67495fec2ec0584e`。

## 实现与来源

70 份上游文件直接引入，MIT 版权与 Three.js 许可随包分发。Git blob
校验清单见 `src/renderer/vendor/design-systems/manifest.json`；`.gitattributes`
固定这批文件为 LF，避免 Windows checkout 改写校验值。

- 透镜：原版 GlassRenderer、JellyController、材质参数、背景绘制、choices
  工厂及音效。设置 / 登录面板各用独立原版 stage，避免重复手势绑定和底层文字透出。
- 点阵：原版 GPU Field、sets、点阵 tabs / sliders / dot text。支持 TIDE
  文字、Lorenz 吸引子、三叶结、FCC 晶格、Klein 瓶及按住熔化 / 松开重组。
- 完整组件：设置中两颗按钮打开原版完整展示，包含透镜 18 类和点阵 14 类
  组件；iframe 使用 `sandbox=allow-scripts`，无 Electron preload bridge。
- 原版 Doto / Atkinson 字体本地打包，保留 SIL OFL。上游点阵展示的在线字体
  链接仅在构建产物中改为内嵌字体，原始 HTML 的 hash 保持不变。

播放器布局、播放事件、曲目数据与中文业务文案仍属于 Tide 的适配层。背景
画面去掉上游演示用 `hello.`，点阵文字替换成 `TIDE`。序曲未加入本次预设。

## 验证

- `npm run verify:design-systems`：70 / 70 原版 Git blob 一致。
- `npm run typecheck`：通过。
- `npm test`：110 / 110 通过。Windows 不再断言不存在的 POSIX `0600`
  语义；Unix 上保留权限断言。歌词按白色峰值背景重新验证对比度，均至少 4.5。
- `npm run build`：通过，包含源码许可、字体许可、完整展示与样式。
- `npm run test:ui`：Playwright + 已安装 Edge，实际渲染器与 IPC fixture。
  内置浏览器调用超时后使用此路径。窗口为 1440×960 与项目最小尺寸 800×560。
  检查设置切换、Lorenz 点集、按住熔化后重组、两套组件展示加载、8 次连续切换、
  点阵播放层独立开关、关闭动效与小窗口面板边界；零 pageerror。

已查看原版完整展示截图和最终播放器截图，逐项核对上游的颜色、厚润玻璃、
弹性反馈、胶囊选择、点阵标签与滑杆、点集形态和字体。组件/材质对齐通过；
播放器的信息布局属于业务适配，不把整页布局描述为上游展示页的像素复制。

截图由 `test:ui` 输出到忽略的 `artifacts/ui-smoke/`。运行此检查需要 Playwright
模块，可用 `TIDE_PLAYWRIGHT_MODULE` 指向已有安装；Windows 默认用 Edge。
`0.9.2-test.1` 继续修正两套外壳的内容边界：透镜首页避开搜索栏；点阵卡片
随内容撑开，使用原版背景和边框 token。原版 GPU `TIDE` 点集放入独立展示区，
首页、子菜单、证明树与弹出面板全部避让；默认保持当前点集，仍可手动切换或
按住熔化后重组。关闭动效时直接同步 GPU 目标缓冲，窗口缩放不再冻结旧位置。

本地添加入口移到「本地音乐」子菜单。网易云歌曲缺图时批量补详情并缓存；
专辑搜索及专辑曲目保留封面，126.net 图片统一 HTTPS。图片加载失败后短暂
回退占位，后续重新进入可重试。当前本地音频仍按文件名索引，未提取内嵌封面。

追加浏览器验证：1440×960、1100×720、800×560 下，两套外壳长标题边界；
点阵展示区与首页控件无交叠；本地子菜单添加及回首页隐藏；歌曲、专辑搜索、
专辑详情图片真实解码成功。IPC 数据使用可重复的 fixture，零 pageerror。

`test:native` 使用真实 Electron/main/preload/API，独立 userData 与随机端口，
文件选择器返回固定测试 WAV；索引、IPC、API 与静音音频播放链路实际运行。
公开网易云封面 CDN 图片实际加载为 2000×2000。真实账号登录、云端音频权限、
硬件媒体键和本地内嵌封面不在本次验收范围。
