// 点阵 Lattice — public API. ES module entry; build.mjs also emits it as a classic script (window.Lattice).
export { clock, tween, wait, Spring, SPRINGS, rng, reducedMotion } from "./core/motion.js";
export { sound } from "./core/sound.js";
export { WORLDS, applyWorldCss, currentWorldName } from "./core/theme.js";
export { Stage } from "./gl/stage.js";
export { Field } from "./gl/field.js";
export * as sets from "./gl/sets.js";
export { Cascade } from "./gl/cascade.js";
export { ProofTree } from "./gl/prooftree.js";
export { DotGrid } from "./gl/dotgrid.js";
export { LabelLayer } from "./dom/labels.js";
export { Dots, mountCanvas, animateWhileVisible } from "./dom/dotkit.js";
export { mountCursor } from "./dom/cursor.js";
export { mountTabs, mountSwitch, mountSlider, mountProgress } from "./dom/controls.js";
export { mountDotText, mountLoader } from "./dom/dottext.js";
export { mountCommands, toast } from "./dom/command.js";
export { THEOREMS, TOPICS, byId, depths } from "./data/analysis.js";
