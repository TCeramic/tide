# 风格包（Style Pack）开发说明

lumisynth 的每一套 PV 视觉语言都是一个风格包。内置四个：凝彩 `tempera`（网点图形 MG）、商籁 `sonnet`（排字运动）、绘光 `lumiere`（光学：体积光、烟雾、光刻字）与花火 `hanabi`（日式 PV：色块字、烟花 MG、持续上升，设计见 `docs/HANABI.md`）。编译器、内核、编辑器只通过契约和注册表访问包，新增一个包不需要改它们。

契约在 `src/packs/contract.ts`，注册表在 `src/packs/registry.ts`。包是自动发现的：一个包放在 `src/packs/<id>/`，由 `pack.ts` **默认导出**（`export default`）StylePack 对象，`src/packs/builtin.ts` 用 `import.meta.glob` 找到并按 `order` 注册，不需要改任何注册代码（`_` 开头的目录是共享代码，不参与发现；包之间不要互相 import，共用的代码放进 `_shared/`），参考 `tempera/pack.ts`、`sonnet/pack.ts`、`lumiere/pack.ts`；最小的可运行示例见 `test/unit/packs/registry.test.ts` 里的玩具包 `lens`。

## 一个包要提供什么

| 字段 | 作用 |
|---|---|
| `id` / `label` / `shortLabel` / `color` | id 不能含 `/`，并与目录名一致；color 用在时间轴与标签上 |
| `order`（可选） | 界面上的顺序，小的在前；排第一的包是找不到指定包时的退路 |
| `families` / `styles` | 风格目录。风格 id 必须是 `<包 id>/<kind>`，每个风格有族与 mood（quiet / neutral / loud）。族可带一句话 `description`（族名看不出画面时写），会进 AI 编排提示词与 agent 的 `list_styles` |
| `transitions` | 段落转场目录：时长公式、是否预卷下一段、进入阶段的时长钳制、`resolveFrame`（纯函数：阶段 + 进度 → 帧）。`joins: true` 的是接缝转场：交界两侧都是本包镜头时内核把两个单元并成一个（需要 `joinParagraphs`），不走 `resolveFrame` |
| `shotBoundaryTransition` | 段内从别的包的镜头切进本包镜头时用的短转场 |
| `tuning` / `params` | 观感设置与编译参数的默认值与 `normalize`（读旧工程时补齐字段）。分别存在工程的 `tuning.packs[id]` 与 `engineParams.packs[id]` |
| `segmentLine` | 把一行切成本包的片段（存在 `UnifiedLine.segments[id]`） |
| `createChain` / `compileParagraph` | 编译：跨段落的状态 + 一段的镜头（切块、选风格、镜头关键帧、装饰，含间奏镜头）。每个镜头要给出锚点：所在行 + slot（`s<n>` 为该行第几个镜头，间奏为 `b<n>`） |
| `chooseTransition` | 自动选段落的出场转场 |
| `seamlessTransition` / `joinParagraphs`（可选） | 接缝转场：前者按 tuning 返回本包段落接本包段落时自动改用的接缝转场 id（null 不改）；后者把首尾相接的几个原生段落并成一个。绘光的「轨迹过渡」就是这样做的 |
| `describeShot` | 原生镜头 → 公共信息与 `ShotSpan`（用文字偏移描述覆盖哪些字） |
| `applyPreRoll`（可选） | 平移类转场的预卷：把段首镜头提前 |
| `fromSpan`（可选） | 按 shot 混用：用别的包镜头的 span 造本包的镜头；做不到返回 null |
| `toNativeParagraph` | 段落（或段内一串连续的本包镜头）→ 包自己的段落结构，交给场景构建器 |
| `createAdapter` | 内核适配器（`src/kernel/adapters/types.ts` 的 `PackAdapter`）：准备资源、构建场景单元、每帧更新、片尾卡、画框装饰 |
| `componentSlots` / `applyComponents`（可选） | 路线 E：除风格（构图）之外可以逐镜头替换的部件，例如排版、点缀。编辑器写 `shot-component` EditOp，编译器只把本包声明过的槽与选项交给 `applyComponents`；`describeShot` 要报出每个槽的当前值。默认值不要写进原生结构（凝彩：`collage` / 原装饰；商籁：排版 = 构图的 kind、点缀 = `standard`） |
| `textRegion`（可选） | 某个风格的构图留给文字的区域（`TextRegion`，相对画面的比例），编辑器在预览上标出来；以后跨包借排版也按它排 |
| `typographyExports` / `textOnlyTuning` / `hideText`（可选） | 跨包借排版。客：导出可借的排版（id、名称、造客镜头用的本包风格 kind）与只画字的 tuning，并实现 `fromSpan`；宿主：`hideText` 隐藏镜头自己的字，且风格要有 `textRegion`。排版槽的值写成 `<客包>/<排版>` |
| `SettingsPanel`（可选） | 「画面与编排」侧栏里本包的设置分组 |

## 约定

- **确定性**：渲染路径里不要用 `Math.random` / `performance.now`。随机用 `src/core/rng.ts` 的 `random()`——内核构建每个场景单元时已经圈定了按 seed + 单元播种的流。每帧的画面只能由时间 t 决定（导出是逐帧 `renderAt(t)`）。
- **选风格的钩子**：`compileParagraph` 收到的 `cast` 里有风格库偏好与族限制过滤后的候选（`filterCandidates`，收藏的出现两次）、显式的 energy（null 表示按包自己的规则）、锁定的风格（`forceKind`）。三者都为空时，包应当按自己原本的规则选。
- **不要自带背景、后处理和段落转场的 filter**：背景（主题色 / 封面）、唯一的后处理链、段落转场的模糊 / 故障 / 擦除都归内核；包的场景容器保持透明。filter 只在真正生效时才挂上（见 `src/packs/tempera/temperaSceneFilters.ts` 对反色 filter 的说明）。
- **尺寸**：场景按逻辑画幅（`KernelContext.width / height`）排版，渲染倍率另给；预览与导出同一套坐标。
- 包缺失时（工程是在装了别的包的机器上做的），编译器退回第一个注册的包，失效的设置列在「问题」面板里；包的 tuning 原样保留在工程里。

## 绘光的写法要点

绘光是第一个不从 folia 搬来、按契约从头写的包，可以当作新包的参考：编译纯数据（`lumiere/program.ts`），一个场景单元一个 `scene.ts`（持续的层整单元一份、随镜头换的层在边界处交叉渐变，所以单元内部不返回 shot 级转场帧），光层输出合法预乘颜色（`alpha = 最大通道`）以便在转场 filter 与透明底上一致，bloom 挂在包自己的子容器上而不是整帧。

- **画框离边缘远一点**：内核默认的镜头畸变（`lensDistortion` 0.3）会把画面边缘往外推，贴边 5% 以内的线会被推出画面。
- **片尾卡**可以复用包自己的文字系统（绘光的曲名就是一行「歌词」，逐字时间按片尾卡内的时间给）；`update(elapsed)` 只收到片尾开始后的秒数，也要纯由它决定。
- **借排版的客单元**只画字：绘光的 `textOnly` 不画图形组，但光照照常在 CPU 上算，字的明暗与宿主里单独播放时一致。
- **tuning 的 `normalize`** 要钳住范围，并把只由内核临时套上的字段（绘光的 `textOnly`）复位，免得存进工程。
