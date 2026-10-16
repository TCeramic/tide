import { themeFromPixels, type GeneratedTheme } from "../core/generated-theme";
import { normalizeArtworkUrl } from "../core/artwork";

let generation = 0, currentId = "";
export function applyGeneratedTheme(theme: GeneratedTheme): void {
  document.documentElement.style.setProperty("--generated-colors", JSON.stringify(theme.colors));
  document.documentElement.style.setProperty("--cover-tint", theme.accent);
  document.documentElement.dataset.generatedTheme = theme.source;
  window.dispatchEvent(new CustomEvent("tide:palette", { detail: theme }));
}
export function updateCoverTheme(id: string, cover: string | undefined, title: string): void {
  const key = `${id}:${cover ?? ""}`; if (key === currentId) return;
  currentId = key; const token = ++generation;
  applyGeneratedTheme(themeFromPixels([], title));
  const url = normalizeArtworkUrl(cover); if (!url) return;
  const image = new Image(); image.crossOrigin = "anonymous"; image.referrerPolicy = "no-referrer";
  image.onload = () => {
    if (token !== generation) return;
    try {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 32;
      const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) return;
      context.drawImage(image, 0, 0, 32, 32);
      applyGeneratedTheme(themeFromPixels(context.getImageData(0, 0, 32, 32).data, title));
    } catch { /* Cross-origin or corrupt covers keep the deterministic local palette. */ }
  };
  image.onerror = () => undefined;
  image.src = url;
}
