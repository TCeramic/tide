import type { Appearance, PerformanceTier, ShellId, StageBackground, VisualPresetId } from "../../shared/contract";

const PRESETS: { id: VisualPresetId; title: string; detail: string }[] = [
  { id: "tide", title: "潮汐默认", detail: "液体玻璃 · 歌词为主" },
  { id: "cover-glow", title: "封面晕影", detail: "封面色晕开 · 字仍清晰" },
  { id: "vinyl", title: "唱片", detail: "圆形封面 · 轻一点的转动" },
  { id: "stardust", title: "星尘", detail: "深空星点 · 方块潮汐" },
  { id: "quiet", title: "留白", detail: "纯净底 · 只留歌词" },
];

const TIERS: { id: PerformanceTier; label: string }[] = [
  { id: "smooth", label: "流畅" },
  { id: "balanced", label: "均衡" },
  { id: "vivid", label: "炫酷" },
];

const BACKGROUNDS: { id: StageBackground; label: string }[] = [
  { id: "solid", label: "纯色" },
  { id: "cover", label: "封面色" },
  { id: "image", label: "本地图片" },
];

const SHELLS: { id: ShellId; label: string }[] = [
  { id: "lens", label: "透镜" },
  { id: "lattice", label: "点阵" },
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
  kicker.textContent = "视觉预设";
  const hint = document.createElement("p");
  hint.className = "library-note";
  hint.textContent = "先选整体风格，再进入细节。歌词可读性优先于效果。";
  const grid = document.createElement("div");
  grid.className = "preset-grid";
  const buttons = new Map<string, HTMLButtonElement>();
  for (const preset of PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-card";
    button.dataset.preset = preset.id;
    const title = document.createElement("strong");
    title.textContent = preset.title;
    const detail = document.createElement("span");
    detail.textContent = preset.detail;
    button.append(title, detail);
    button.addEventListener("click", () => {
      void window.tide.setAppearance({ preset: preset.id });
    });
    buttons.set(`preset:${preset.id}`, button);
    grid.append(button);
  }

  const detailHeading = document.createElement("p");
  detailHeading.className = "preset-kicker";
  detailHeading.textContent = "细节";
  const tierRow = choiceRow("性能", TIERS, (id) => void window.tide.setAppearance({ performance: id }), buttons, "performance");
  const backgroundRow = choiceRow("背景", BACKGROUNDS, (id) => void window.tide.setAppearance({ background: id }), buttons, "background");
  const shellRow = choiceRow("外壳", SHELLS, (id) => void window.tide.setAppearance({ shell: id }), buttons, "shell");
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
  later.textContent = "封面粒子、黑胶细调和简易频谱还在后面。这一版只切换场景配方。";
  root.append(kicker, hint, grid, detailHeading, tierRow, backgroundRow, shellRow, imageButton, later);

  return {
    element: root,
    sync(appearance) {
      for (const [key, button] of buttons) {
        const [group, id] = key.split(":");
        const on = group === "preset"
          ? appearance.preset === id
          : group === "performance"
            ? appearance.performance === id
            : group === "background"
              ? appearance.background === id
              : appearance.shell === id;
        button.setAttribute("aria-pressed", on ? "true" : "false");
      }
    },
  };
}

function choiceRow<T extends string>(
  label: string,
  options: readonly { id: T; label: string }[],
  onPick: (id: T) => void,
  buttons: Map<string, HTMLButtonElement>,
  group: string,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "preset-row";
  const name = document.createElement("span");
  name.textContent = label;
  row.append(name);
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-button";
    button.textContent = option.label;
    button.addEventListener("click", () => onPick(option.id));
    buttons.set(`${group}:${option.id}`, button);
    row.append(button);
  }
  return row;
}
