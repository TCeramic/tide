# 点阵 Lattice · 粒子点阵设计系统

万物皆点集，交互即映射。给个人网站与公开发布的 WebGL 动画使用的设计系统：页面底下是一张点阵，名字、模型、定理、证明全部由点组成，所有交互都是从一个点集到另一个点集的映射。世界为 **夜 Night**。

- **直接打开**：[dist/lattice-showcase.html](dist/lattice-showcase.html)（单文件 659 KB，three.js 已打包；仅字体走 Google Fonts，离线时回退系统字体）
- **本地查看页**：[dist/catalog/index.html](dist/catalog/index.html)（ds-viewer 生成：令牌、字体、封面与 14 张可交互组件卡）
- **设计规格**：[DESIGN.md](DESIGN.md) · **产品背景**：[PRODUCT.md](PRODUCT.md) · **验证记录**：[VERIFICATION.md](VERIFICATION.md)

## 包含什么

| 部件 | 文件 | 说明 |
| --- | --- | --- |
| 点场 Field（签名） | `src/gl/field.js` | GPU 模拟 65,536 点（手机 25,600）；弹簧入集、ABC 流过渡、指针场、按住熔化、点击冲击波、拖拽旋转 3D 集 |
| 点集 Sets | `src/gl/sets.js` | 点阵、5×7 点阵字、洛伦兹吸引子、三叶结、面心立方晶体、克莱因瓶、斐波那契球 |
| 定理之瀑 Cascade（签名） | `src/gl/cascade.js` | 依赖 DAG 以瀑布倾泻；悬停显示上游（橙）与下游（冰蓝）；点击生长证明树。展示页有两个版本：自由探索（小而透明的说明）与巡游（随滚动按依赖顺序逐个悬停 16 个关键结果，每两格滚轮一个，无侧栏） |
| 证明树 ProofTree（签名） | `src/gl/prooftree.js` | 把 DAG 展开成以结论为根、公理为叶的证明树；相机到达时开始生长，旁边进度条同步结晶；`swap(id)` 旋转转场，展示页用它随滚动连播 6 棵证明树 |
| 舞台 Stage | `src/gl/stage.js` | 单一 WebGL 上下文、滚动驱动的相机站点、辉光、自适应分辨率、不可见时停机 |
| 光标光环 | `src/dom/cursor.js` | 光标的点集在可操作控件轮廓上重组，兼作键盘焦点指示 |
| 控件 | `src/dom/controls.js` | 标签页（点群指示器）、开关（气态/晶态）、滑块（点列）、进度（结晶） |
| 点阵字与加载器 | `src/dom/dottext.js` | 字符串之间逐点重排；洛伦兹轨迹加载器 |
| 命令面板与消息 | `src/dom/command.js` | ⌘K / Ctrl+K；消息带点阵标签 |
| 声音 | `src/core/sound.js` | 合成音色，默认关闭 |
| 数据 | `src/data/analysis.js` | 43 条实分析结果的依赖图（ZFC → Picard–Lindelöf / Peano） |
| 令牌与样式 | `src/tokens.css` · `src/components.css` | 颜色、字体、间距、组件样式 |

## 开发与构建

```powershell
Set-Location lattice
npm install
node serve.mjs 4187        # http://127.0.0.1:4187/showcase/
node build.mjs             # 生成 dist/lattice-showcase.html，并刷新 project/ 与 dist/catalog/
```

依赖只在本目录：`three@0.186.1`（运行时，被打包进单文件）、`esbuild`、`playwright-core`（仅截图与测试，使用本机 Chrome/Edge）。

## 接入示例

```js
import { Stage } from "./src/gl/stage.js";
import { Field } from "./src/gl/field.js";
import * as SETS from "./src/gl/sets.js";
import { WORLDS } from "./src/core/theme.js";

const stage = new Stage(canvas, [{ id: "hero", el: ".hero", pos: [0, 0, 10], look: [0, 0, 0] }], WORLDS.night);
const field = new Field(stage);
field.useSets(SETS);
stage.add(field);
field.onResize(stage);
// 任意点集：返回 N×4 的 Float32Array（xyz + 类别 w：0 隐藏 · 0.35 点阵 · 1 点亮）
field.keep((L) => L.lit([{ map: SETS.matrixText("HELLO", 2), col: 10, row: 12 }]), { dur: 1.5 });
field.keep((L) => L.shape(SETS.lorenz(field.N, 2)), { is3d: true, alpha: 0.22 });
```

依赖图数据只需 `{ id, en, zh, st, deps, kind, topic, leaf? }`：`new Cascade({ theorems, depth, topicOrder })`、`new ProofTree({ byId }).grow(id)`。换成自己的主题图（课程、项目、因子）即可复用两个签名页面。

DOM 控件保留原生语义，只在上面画点：`mountTabs(el)`、`mountSwitch(btn)`、`mountSlider(input)`、`mountProgress(el).set(0.4)`、`mountDotText(el).set("QED")`、`mountLoader(el)`、`mountCommands([...])`、`toast("…", { tag: "OK" })`、`mountCursor()`。

## 工具

| 脚本 | 作用 |
| --- | --- |
| `tools/build-project.mjs` | 从源码生成 `project/`（令牌解析自 `src/tokens.css`、`window.Lattice` 经典脚本包、组件预览来自 `catalog/`），再调用 ds-viewer |
| `tools/author-catalog.py` | 组件卡的源文件（预览与说明）写入 `catalog/components/` |
| `tools/smoke.mjs` | 交互冒烟测试（30 项，含减少动态） |
| `tools/check-dist.mjs` · `tools/check-catalog.mjs` | 单文件与查看页的无头检查 |
| `tools/capture.mjs` | 逐帧确定的截图与对比图 |

`project/` 与 `dist/` 都是生成物，不要手改。

## 录制动画（配合 Video Gen）

在地址后加 `?record`，时间只由 `lattice.renderAt(t)` 推进，逐帧确定。`tools/capture.mjs` 是可直接改写的逐帧截图示例：

```powershell
node tools/capture.mjs              # 夜间世界的 6 个场景 + 对比图，输出到 outputs/captures/
```

## 需要替换的内容

- 联系按钮的 `mailto:you@example.com`（带 `data-placeholder`）。
- 「标签页」与「证明树」旁的项目简介为根据会话整理的示意文字，请改成正式文案与链接。
- 定理之瀑使用真实的实分析依赖数据；如需换成自己的课程或项目图，替换 `src/data/analysis.js`。

## 已知限制

- 字体来自 Google Fonts；完全离线时回退到系统字体（点阵字 5×7 位图不受影响）。
- 已在无头 Chrome（Intel Arc 140T，D3D11）上验证；尚未在 iPhone、Android 实机与 Safari 上验证。
- 声音未经人工试听验收；视觉由用户选定方向，最终视觉验收待用户确认。
- `?world=paper` / `?world=ultramarine` 仍可用于实验，但不是本系统的承诺世界。
