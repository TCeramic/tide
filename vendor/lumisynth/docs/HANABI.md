# 花火 hanabi 设计说明

日式歌词 PV（lyric motion video）风格：每句歌词带着自己的字底色块出场，烟花一样的 MG 装饰件沿着文字开花、闪烁、飘落；
镜头与镜头之间整个世界持续向上升，像跟着一发发打上天的烟花一路往上走，形成一场连续的烟花表演。
文字动画与 MG 件都尽量复杂：逐字入场 / 被唱到时强调 / 逐字退场三段，每段十几种，由 50 个预设组合出来。

共享类型在 `src/packs/hanabi/types.ts`，包的约定见 `docs/PACKS.md`。

## 模块

```
src/packs/hanabi/
  types.ts        共享类型与模块函数签名（接口的唯一来源）
  pack.ts         StylePack（默认导出，order 40）
  catalog.ts      10 族 × 5 = 50 个预设（HanabiProfile，全是数据）
  program.ts      编译：切块、选预设（纯数据，不碰 Pixi）
  color.ts        调色板：PaletteRole × 主题 × tuning.colorMode → HanabiPalette
  scene.ts        一个场景单元：世界上升 + 每镜头组装文字 / 装饰件 / 烟花 / 尾迹
  adapter.ts      接入内核（PackAdapter）
  settings.tsx    设置面板
  credits.ts      片尾卡（曲名 + 艺人，一发大烟花）
  overlay.ts      画框装饰（角标、竖排小字）
  text/           文字引擎：字形纹理、排版、字底色块、逐字动画 → createHanabiText
  mg/             MG 部件库：纹理、烟花、装饰件、环境层 → createHanabiTextures / createFireworks / createOrnament / createAmbient
```

## 画面分层（一个单元）

```
单元容器（透明，内核给背景）
├ ambient.back            远处星点、远方小烟花、烟雾（屏幕坐标，按 rise 自己做视差 0.2–0.6，不放进 world）
└ world（摄影机上摇：y = rise(t)）
   ├ 每个镜头一个 shot 容器（放在世界里各自的高度）
   │   ├ fireworks         主烟花、被唱到时的小烟花、升空尾迹
   │   ├ ornaments(back)
   │   ├ text.blocks       字底色块（文字引擎画）
   │   ├ mid               素材插入层（内核）
   │   ├ text.glyphs       字
   │   └ ornaments(front)
└ ambient.front           上升的火星、前景散景（同上，视差 1.2–1.5）
```

## 上升

- 镜头 i 的内容放在世界坐标 `y_i = y_{i-1} - rise_i * H`（`rise_i` 取自预设 camera.rise × tuning.riseSpeed）。
- 世界偏移 `rise(t)`：镜头内缓慢匀速上漂（每秒约 2% 画面高度），镜头边界前后约 0.6 秒用 easeInOutCubic 把镜头 i 的中心移到画面文字区——
  像摄影机跟着升空尾迹往上摇。只由 t 决定。
- 摄影机往上摇：新镜头在上方，画面里的内容整体向下流，上一个镜头的字在边界处退场（默认 ascend：逐字向上飞走）的同时从画面下缘出去；
  下一个镜头的升空尾迹在文字入场前约 0.45 秒从画面底边升起，到达文字区时开主烟花、文字入场。连续几个镜头就是连续的「打上げ → 开花 → 上升 → 打上げ」。具体公式见 `timeline.ts`。
- 段落没有出场转场时（全曲最后一段、段内接别的包的镜头、风格库缩略图），最后一个镜头的字留到单元结束。
- 间奏镜头（isBridge）：没有字，放一组スターマイン / 千輪，世界照常上升。

## 预设的组成

`HanabiProfile` = 文字（排法、字号、色块、入场、强调、退场、描边 / 硬阴影）+ 主烟花与开在哪 + 被唱到时的小烟花 + 2–4 个 MG 装饰件 +
是否有升空尾迹 + 调色板角色 + 运镜（上升距离、推近、摆动、入场震动）。
组件槽（逐镜头替换）：`typography`（排版：换成任一预设的文字处理——排法、字号、色块、逐字动画）、`block`（字底色块）、`enter`（入场动画）、`burst`（主烟花种类）。
色块与入场的默认值跟着排版走；和默认相同的不写进原生结构。

跨包借排版：
- 当客：导出 14 个预设的排版（覆盖全部色块，外加竖排、拱弧、故障），值为 `hanabi/<预设 kind>`。客单元只画字与字底色块，不上升、不放烟花与装饰件，字停在宿主的文字区里。
- 当宿主：排版槽里同时列出别的包可借的排版；借用时花火自己的字隐去，烟花、装饰件与上升照常。

## 10 族

| 族 | 名称 | 画面 |
|---|---|---|
| uchiage | 打上 | 升空尾迹从底边升起，字从下往上 rise 入场，开菊 / 牡丹，最典型的上升感 |
| kiku | 菊 | 居中大字，背后开带尾迹的菊花，集中线、扩散圆环 |
| botan | 牡丹 | 大色块（band / tile / double），pop / stamp 入场，饱满色点 |
| yanagi | 柳 | 竖排、慢，柳火与冠下垂，字 fall 退场，安静 |
| senrin | 千輪 | 每个被唱到的字各放一朵小花，scatter / stagger 排版，快节奏 |
| hoshikuzu | 星屑 | 四角星、光点、点线，glow 强调，dissolve 退场，梦幻 |
| obi | 帯 | 日式 PV 的色带排字：斜块、票据、荧光笔、错落阶梯，wipe / type / slide |
| senko | 閃光 | 点滅、glitch、scramble、strobe，速度线，硬切 |
| senkohanabi | 線香 | 线香花火：小而密的火花贴着字噼啪，温柔，暗色调 |
| shakudama | 尺玉 | 一两个字的超大显示，巨大的冠 / 双层烟花、旭日放射，副歌高潮 |

覆盖要求：每种 EnterFx、BlockStyle、BurstKind、OrnamentKind 至少被两个预设用到；每个预设的（排法、色块、入场、主烟花）组合互不相同。

## 约定

- 确定性：不用 `Math.random` / `performance.now`，随机用 `createRng(key)`；每帧画面只由 t 决定（粒子位置用解析式从 `t - at` 算，不积分）。
- 性能：一个单元的烟花精灵池上限约 1500；粒子全用共享纹理的 Sprite；Graphics 只画少量需要逐帧变形的装饰件。镜头不在可见时间附近时不更新、不渲染。
- 容器透明，不自带背景与后处理；辉光 filter 只在 tuning.glow > 0 时挂在烟花层上。
- 文字纹理按 renderResolution 画，导出不糊；单元 destroy 时释放。
