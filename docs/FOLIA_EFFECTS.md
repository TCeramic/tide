# Folia 商籁与绘光实现评估

2026-10-17，已读取 Folia `aba2da2bf4bbea60a32117e022e0f459cf73270e` 的说明与运行时源码。结论：两种模式技术上可以在 Tide 中实现；它们是完整歌词舞台，而非简单 CSS 预设。本次先完成用户此前的交互修正与背景效果，不宣称已交付这两套舞台。

## 商籁 Sonnet

[入口](https://github.com/chthollyphile/folia-major/blob/aba2da2bf4bbea60a32117e022e0f459cf73270e/src/components/visualizer/sonnet/VisualizerSonnet.tsx)、[运行时](https://github.com/chthollyphile/folia-major/blob/aba2da2bf4bbea60a32117e022e0f459cf73270e/src/components/visualizer/sonnet/createSonnetPixiRuntime.ts)、[程序编排](https://github.com/chthollyphile/folia-major/blob/aba2da2bf4bbea60a32117e022e0f459cf73270e/src/components/visualizer/sonnet/sonnetProgram.ts)。

以整首歌词的时间线编排段落和镜头，逐字字形、版式、图形、画框和转场配合绝对播放时间运行。实现边界包括字体与字形测量、段落程序、相机运动、场景缓存、纹理池和切歌溶解。

Tide 已有逐字时间与播放时钟、配色及音频分析，可复用这些基础。还需要单独构建舞台布局/镜头程序及图形素材系统。跳转时间、循环、换歌均应从绝对时钟恢复，而不能依靠一串无法回退的定时动画。

## 绘光 Lumiere

[入口](https://github.com/chthollyphile/folia-major/blob/aba2da2bf4bbea60a32117e022e0f459cf73270e/src/components/visualizer/lumiere/VisualizerLumiere.tsx)、[运行时](https://github.com/chthollyphile/folia-major/blob/aba2da2bf4bbea60a32117e022e0f459cf73270e/src/components/visualizer/lumiere/createLumierePixiRuntime.ts)、[音频处理](https://github.com/chthollyphile/folia-major/blob/aba2da2bf4bbea60a32117e022e0f459cf73270e/src/components/visualizer/lumiere/lumiereAudio.ts)。

由舞台光束、烟雾、浮尘和线稿构成空间，歌词随光位逐行点亮；段落间运镜、灯位交接，音频能量使用起音/释放平滑。其低画质主要降低光场/filter 分辨率，保留文字清晰度。

Tide 对应实现需要独立光场 Shader、文字遮罩与光束联动、烟雾/粒子批处理和镜头时间线。当前新增的背景节拍信号是可用输入，但不等于已实现绘光。

## 性能与代码边界

两套舞台都应只在选中时创建一个渲染器；切歌复用上下文，只缓存当前段落与相邻段落。隐藏窗口暂停视觉调度，音频与播放时钟保持；恢复时按当前时间定位。文字保持清晰，优先减少离屏滤镜像素、重复纹理和不可见场景，保留运动和空间效果。

Folia 为 AGPL 项目。本仓库当前采用独立实现方式研究交互与结构；本次未复制 Folia 舞台源码进入 Tide。完整接入其源码需要另行处理项目许可与分发方式，不能把直接复制冒充 Tide 自主实现。
