interface CoverSample {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

const samples = new Map<string, CoverSample>();
const MAX_CACHE = 24;
const MAX_OUTPUT = 1024;
const STYLE_KEY = "tide.desktop.pixel-covers.v1";
const STYLE_EVENT = "tide:pixel-cover-style";
export function isCoverStyleEnabled(): boolean {
  try { return localStorage.getItem(STYLE_KEY) !== "off"; } catch { return true; }
}
export function setCoverStyleEnabled(enabled: boolean): void {
  try { localStorage.setItem(STYLE_KEY, enabled ? "on" : "off"); } catch { /* Keep the UI usable without storage. */ }
  document.documentElement.dataset.pixelCovers = enabled ? "on" : "off";
  window.dispatchEvent(new Event(STYLE_EVENT));
}

export function halftoneDotRadius(luminance: number): number {
  return 0.55 * Math.sqrt(1 - Math.min(1, Math.max(0, luminance)));
}

/** An actual two-ink print of the artwork; the original is retained underneath for CORS fallback. */
export function installCoverHalftone(host: HTMLElement): () => void {
  const canvas = document.createElement("canvas");
  canvas.className = "cover-halftone";
  canvas.setAttribute("aria-hidden", "true");
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;
  let sampler: HTMLImageElement | null = null;
  let samplerUrl = "";
  let failedUrl = "";
  let frame = 0;
  let disposed = false;
  let lastRenderKey = "";
  let boundImage: HTMLImageElement | null = null;

  const removeCanvas = () => {
    canvas.remove();
    host.classList.remove("has-cover-halftone");
    host.classList.remove("cover-style-pending");
    lastRenderKey = "";
  };
  const queueRender = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; refresh(); });
  };
  const refresh = () => {
    if (disposed) return;
    const root = document.documentElement;
    const enabled = root.dataset.pixelCovers ? root.dataset.pixelCovers !== "off" : isCoverStyleEnabled();
    if (root.dataset.mobile === "true" || root.dataset.shell !== "lattice" || !enabled) { removeCanvas(); return; }
    const image = host.querySelector<HTMLImageElement>("img");
    if (boundImage !== image) {
      boundImage?.removeEventListener("load", queueRender);
      boundImage = image;
      image?.addEventListener("load", queueRender);
      removeCanvas();
    }
    if (!image) { removeCanvas(); return; }
    if (!canvas.isConnected) host.classList.add("cover-style-pending");
    const rawUrl = image.currentSrc || image.src;
    if (!rawUrl || !image.complete || image.naturalWidth <= 0) return;
    let url: string;
    try { url = new URL(rawUrl, document.baseURI).href; } catch { return; }
    const rect = host.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1, MAX_OUTPUT / Math.max(rect.width, rect.height));
    const outputWidth = Math.max(1, Math.round(rect.width * ratio));
    const outputHeight = Math.max(1, Math.round(rect.height * ratio));
    // Smaller art has a finer screen so eyes and silhouettes remain recognizable.
    const cell = Math.max(2, Math.min(5, Math.min(rect.width, rect.height) / 112));
    const width = Math.max(8, Math.round(rect.width / cell));
    const height = Math.max(8, Math.round(rect.height / cell));
    const theme = root.dataset.colorMode === "light" ? "light" : "dark";
    const key = `${url}|${outputWidth}x${outputHeight}|${width}x${height}|${theme}`;
    if (key === lastRenderKey && canvas.isConnected) return;
    if (failedUrl === url) { removeCanvas(); return; }
    const sampleKey = `${url}|${width}x${height}`;
    let sample = samples.get(sampleKey);
    if (!sample) {
      if (samplerUrl !== url) {
        removeCanvas();
        samplerUrl = url;
        host.classList.add("cover-style-pending");
        const next = new Image();
        sampler = next;
        next.crossOrigin = "anonymous";
        next.referrerPolicy = "no-referrer";
        next.onload = () => { if (!disposed && sampler === next) queueRender(); };
        next.onerror = () => { if (sampler === next) { failedUrl = url; removeCanvas(); } };
        next.src = url;
        return;
      }
      if (!sampler?.complete || sampler.naturalWidth <= 0) return;
      try {
        const buffer = document.createElement("canvas");
        buffer.width = width; buffer.height = height;
        const read = buffer.getContext("2d", { willReadFrequently: true });
        if (!read) return;
        // Match object-fit: cover instead of stretching rectangular artwork.
        const scale = Math.max(width / sampler.naturalWidth, height / sampler.naturalHeight);
        const sw = width / scale, sh = height / scale;
        read.drawImage(sampler, (sampler.naturalWidth - sw) / 2, (sampler.naturalHeight - sh) / 2, sw, sh, 0, 0, width, height);
        sample = { width, height, pixels: read.getImageData(0, 0, width, height).data };
        samples.set(sampleKey, sample);
        while (samples.size > MAX_CACHE) samples.delete(samples.keys().next().value!);
      } catch { failedUrl = url; removeCanvas(); return; }
    }
    samples.delete(sampleKey); samples.set(sampleKey, sample);
    canvas.width = outputWidth; canvas.height = outputHeight;
    const dark = theme === "dark";
    const palette = dark ? ["#170f10", "#67301a", "#cd6329", "#ffd095"] : ["#102951", "#275eac", "#76b2e9", "#e7f6ff"];
    context.fillStyle = palette[0]!;
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.imageSmoothingEnabled = false;
    const sx = outputWidth / width, sy = outputHeight / height;
    const histogram = new Uint32Array(256);
    for (let i = 0; i < sample.pixels.length; i += 4) histogram[Math.round(sample.pixels[i]! * .2126 + sample.pixels[i + 1]! * .7152 + sample.pixels[i + 2]! * .0722)]!++;
    let low = 0, high = 255, count = 0;
    for (let i = 0; i < 256; i++) { count += histogram[i]!; if (count >= width * height * .025) { low = i; break; } }
    count = 0;
    for (let i = 255; i >= 0; i--) { count += histogram[i]!; if (count >= width * height * .025) { high = i; break; } }
    const black = Math.max(0, low / 255 - .03), range = Math.max(.32, (high - low) / 255 + .06);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const luminance = (sample.pixels[offset]! * .2126 + sample.pixels[offset + 1]! * .7152 + sample.pixels[offset + 2]! * .0722) / 255;
        const tone = Math.pow(Math.min(1, Math.max(0, (luminance - black) / range)), .8);
        const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(y % 4) * 4 + x % 4]! / 16 - .5;
        const level = Math.max(0, Math.min(3, Math.round(tone * 3 + bayer * .8)));
        context.fillStyle = palette[level]!;
        context.fillRect(Math.floor(x * sx), Math.floor(y * sy), Math.ceil(sx), Math.ceil(sy));
      }
    }
    canvas.dataset.state = "rendered";
    if (canvas.parentElement !== host) host.append(canvas);
    host.classList.add("has-cover-halftone");
    host.classList.remove("cover-style-pending");
    lastRenderKey = key;
  };

  const resizeObserver = new ResizeObserver(queueRender);
  resizeObserver.observe(host);
  const hostObserver = new MutationObserver(queueRender);
  hostObserver.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
  const themeObserver = new MutationObserver(queueRender);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mobile", "data-shell", "data-color-mode"] });
  refresh();
  window.addEventListener(STYLE_EVENT, queueRender);
  return () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    resizeObserver.disconnect(); hostObserver.disconnect(); themeObserver.disconnect();
    window.removeEventListener(STYLE_EVENT, queueRender);
    boundImage?.removeEventListener("load", queueRender);
    if (sampler) { sampler.onload = null; sampler.onerror = null; sampler.removeAttribute("src"); }
    sampler = null;
    removeCanvas();
  };
}

/** Covers may be replaced by paintCover; watch the stable parent and release removed hosts. */
export function installCoverHalftones(root: HTMLElement, selector: string): () => void {
  const installed = new Map<HTMLElement, () => void>();
  const sync = () => {
    for (const [host, stop] of installed) if (!root.contains(host)) { stop(); installed.delete(host); }
    for (const host of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
      if (!installed.has(host)) installed.set(host, installCoverHalftone(host));
    }
  };
  const observer = new MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: true });
  sync();
  return () => { observer.disconnect(); for (const stop of installed.values()) stop(); installed.clear(); };
}
