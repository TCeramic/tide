// 界 Worlds — one grammar (points, sets, fields, maps), three material renditions.
// night: points of light on deep ink · paper: graphite dots on dot-grid paper · ultramarine: chalk dots on a drenched blue field

export const WORLDS = {
  night: {
    label: "夜 Night",
    bg: "#07080b", ink: "#ece7da", hot: "#ff5a1f", hot2: "#7fd8ff",
    text: "#ece7da", textDim: "#9d988c", line: "rgb(236 231 218 / 0.14)", panel: "rgb(7 8 11 / 0.78)",
    blend: "additive", bloom: 0.55, shadow: false, gridAlpha: 0.22, dotGain: 1.0,
  },
  paper: {
    label: "纸 Paper",
    bg: "#eff0ec", ink: "#1b1d22", hot: "#2445ff", hot2: "#ff3d1f",
    text: "#15171b", textDim: "#5b5e66", line: "rgb(21 23 27 / 0.14)", panel: "rgb(239 240 236 / 0.86)",
    blend: "normal", bloom: 0, shadow: true, gridAlpha: 0.36, dotGain: 1.0,
  },
  ultramarine: {
    label: "蓝 Ultramarine",
    bg: "#1a2cc0", ink: "#f4f1e8", hot: "#e8ff3c", hot2: "#ff9a4a",
    text: "#f4f1e8", textDim: "#bcc3f5", line: "rgb(244 241 232 / 0.2)", panel: "rgb(26 44 192 / 0.8)",
    blend: "additive", bloom: 0.22, shadow: false, gridAlpha: 0.3, dotGain: 0.9,
  },
};

export function currentWorldName() {
  const q = new URLSearchParams(location.search).get("world");
  if (q && WORLDS[q]) return q;
  try { const s = localStorage.getItem("lattice.world"); if (s && WORLDS[s]) return s; } catch {}
  return "night";
}

/** Push the world's colours into CSS custom properties so DOM parts follow the field. */
export function applyWorldCss(name) {
  const w = WORLDS[name];
  const r = document.documentElement.style;
  r.setProperty("--bg", w.bg);
  r.setProperty("--ink", w.ink);
  r.setProperty("--hot", w.hot);
  r.setProperty("--hot-2", w.hot2);
  r.setProperty("--text", w.text);
  r.setProperty("--text-dim", w.textDim);
  r.setProperty("--line", w.line);
  r.setProperty("--panel", w.panel);
  document.documentElement.dataset.world = name;
  document.documentElement.style.colorScheme = name === "paper" ? "light" : "dark";
}
