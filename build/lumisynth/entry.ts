// Pixi's official CSP-safe polyfills avoid its default eval-based capability
// probes and uniform synchronization. Keep the renderer CSP strict; this is
// loaded only with the lazy lyric-stage bundle.
import "pixi.js/unsafe-eval";

import { compileLumiProgram } from "../../vendor/lumisynth/src/compiler/compile";
import { LumiKernel } from "../../vendor/lumisynth/src/kernel/runtime";
import { getPack, registerPack } from "../../vendor/lumisynth/src/packs/registry";
import { DEFAULT_KERNEL_TUNING } from "../../vendor/lumisynth/src/kernel/tuning";
import sonnetPack from "../../vendor/lumisynth/src/packs/sonnet/pack";
import temperaPack from "../../vendor/lumisynth/src/packs/tempera/pack";
import lumierePack from "../../vendor/lumisynth/src/packs/lumiere/pack";
import hanabiPack from "../../vendor/lumisynth/src/packs/hanabi/pack";

for (const pack of [sonnetPack, temperaPack, lumierePack, hanabiPack]) registerPack(pack);

export { compileLumiProgram, LumiKernel, getPack, DEFAULT_KERNEL_TUNING };
