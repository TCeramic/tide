import type { Appearance, FontPresetId, PerformanceTier, ShellId, StageBackground } from "../../shared/contract";

import { createNativeChoiceRow } from "../native-shell.js";

const TIERS: { id: PerformanceTier; label: string }[] = [
  { id: "smooth", label: "低" },
  { id: "balanced", label: "中" },
  { id: "vivid", label: "高" },
];

const BACKGROUNDS: { id: StageBackground; label: string }[] = [
  { id: "solid", label: "纯色" },
  { id: "cover", label: "封面色" },
  { id: "paper", label: "流动配色" },
  { id: "pixel-cover", label: "像素封面" },
  { id: "image", label: "本地图片" },
];

const SHELLS: { id: ShellId; label: string }[] = [
  { id: "lens", label: "透镜" },
  { id: "lattice", label: "点阵" },
];

const FONTS: { id: FontPresetId; label: string }[] = [
  { id: "system", label: "系统" },
  { id: "song", label: "宋体" },
  { id: "serif", label: "衬线" },
  { id: "mono", label: "等宽" },
  { id: "custom", label: "自定义" },
];

/** Two steps: pick a scene, then the small set of details. */
export function mountPresetForm(): {
  element: HTMLElement;
  sync: (appearance: Appearance) => void;
} {
  const root = document.createElement("section");
  root.className = "preset-form";
  const kicker = document.createElement("p");
  kicker.className = "preset-kicker";
  kicker.textContent = "外观与动效";
  const hint = document.createElement("p");
  hint.className = "library-note";
  hint.textContent = "封面流动配色跟随歌曲；低档静态，中档柔和过渡，高档完整动态。";
  const detailHeading = document.createElement("p");
  detailHeading.className = "preset-kicker";
  detailHeading.textContent = "细节";
  const tierRow = createNativeChoiceRow("性能", TIERS, (id) => void window.tide.setAppearance({ performance: id as PerformanceTier }));
  const backgroundRow = createNativeChoiceRow("背景", BACKGROUNDS, (id) => void window.tide.setAppearance({ background: id as StageBackground }));
  const emblemRow=createNativeChoiceRow("TIDE 标识材质",[{id:"auto",label:"随设计系统"},{id:"liquid-metal",label:"Liquid Metal"}],id=>void window.tide.setAppearance({emblem:id as "auto"|"liquid-metal"}));
  const shellRow = createNativeChoiceRow("设计系统", SHELLS, (id) => void window.tide.setAppearance({ shell: id as ShellId }));
  let currentShell: ShellId = "lens";
  const modeRow = createNativeChoiceRow("明暗模式", [{ id: "light", label: "明亮" }, { id: "dark", label: "深色" }], id => void window.tide.setAppearance(currentShell === "lens" ? { lensMode: id as "light" | "dark" } : { latticeMode: id as "light" | "dark" }));
  const fontRow = createNativeChoiceRow("字体", FONTS, (id) => void window.tide.setAppearance({ fontPreset: id as FontPresetId }));
  const family = document.createElement("input");
  family.type = "text";
  family.className = "key-input";
  family.maxLength = 80;
  family.placeholder = "字体族名，例如 Source Han Sans SC";
  family.setAttribute("aria-label", "字体族名");
  family.addEventListener("change", () => {
    void window.tide.setAppearance({ fontPreset: "custom", fontFamily: family.value.trim() });
  });
  const importFont = document.createElement("button");
  importFont.type = "button";
  importFont.className = "text-button";
  importFont.textContent = "导入字体文件";
  importFont.addEventListener("click", () => {
    void window.tide.pickFont();
  });
  const imageButton = document.createElement("button");
  imageButton.type = "button";
  imageButton.className = "text-button";
  imageButton.textContent = "选择背景图片";
  imageButton.addEventListener("click", () => {
    void window.tide.pickBackdrop().then((url) => {
      if (!url) return;
      document.documentElement.style.setProperty("--tide-image", `url("${url}")`);
      void window.tide.setAppearance({ background: "image" });
    });
  });
  const later = document.createElement("p");
  later.className = "library-note";
  later.textContent = "Lens / Lattice · DayDreamInAReverie · MIT";
  root.append(kicker, hint, shellRow.element, modeRow.element, detailHeading, tierRow.element, backgroundRow.element, emblemRow.element, fontRow.element, family, importFont, imageButton, later);

  return {
    element: root,
    sync(appearance) {
      currentShell = appearance.shell;
      modeRow.sync(appearance.shell === "lens" ? appearance.lensMode ?? (appearance.theme === "dusk" ? "dark" : "light") : appearance.latticeMode ?? "dark");
      shellRow.sync(appearance.shell);
      tierRow.sync(appearance.performance);
      backgroundRow.sync(appearance.background);emblemRow.sync(appearance.emblem??"auto");
      fontRow.sync(appearance.fontPreset);
      if (document.activeElement !== family) family.value = appearance.fontFamily;
    },
  };
}
