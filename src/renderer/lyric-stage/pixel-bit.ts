import { toLumiLines } from "./lines";
import type { LumiLine } from "./engine";
import type { LyricStageErrorHandler, LyricStageHandle, LyricStageState } from "./index";

const hexChannels = (value: string): [number, number, number] | null => {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map(char => char + char).join("") : match[1];
  return [
    Number.parseInt(digits.slice(0, 2), 16),
    Number.parseInt(digits.slice(2, 4), 16),
    Number.parseInt(digits.slice(4, 6), 16),
  ];
};

const paint = (color: string, alpha: number, fallback: string): string => {
  const channels = hexChannels(color) ?? hexChannels(fallback) ?? [255, 255, 255];
  return `rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${alpha})`;
};

/** An original low-resolution lyric console. Every frame derives from Tide's audio time. */
export function mountBitStage(parent: HTMLElement, initial: LyricStageState, onError?: LyricStageErrorHandler): LyricStageHandle {
  const host = document.createElement("div");
  host.className = "tide-lyric-stage-host";
  host.dataset.pack = "pixel-bit";
  host.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  canvas.className = "tide-lyric-stage-canvas tide-bit-stage-canvas";
  host.append(canvas);
  parent.prepend(host);
  const context = canvas.getContext("2d", { alpha: true });
  let state = initial;
  let visible = true;
  let destroyed = false;
  let lines: LumiLine[] = [];
  let inputs: unknown[] = [];
  let lastPosition = Number.NaN;
  let lastTheme: LyricStageState["theme"] | null = null;
  let lastRender = 0;

  const wrap = (text: string, width: number): string[] => {
    if (!context) return [];
    const rows: string[] = [];
    let row = "";
    for (const char of Array.from(text)) {
      if (row && (char === "\n" || context.measureText(row + char).width > width)) { rows.push(row); row = ""; }
      if (char !== "\n") row += char;
    }
    if (row) rows.push(row);
    return rows;
  };

  const render = (force = false) => {
    if (destroyed || !visible || !context) return;
    const next = [state.trackId, state.yrc, state.original, state.translation, state.romanization, state.durationMs];
    const changed = next.some((value, index) => value !== inputs[index]);
    if (changed) {
      inputs = next;
      lines = toLumiLines(state, state.durationMs);
    }
    const now = performance.now();
    if (!force && !changed && state.theme === lastTheme && state.positionMs === lastPosition) return;
    const frame = 1000 / (state.performance === "smooth" ? 30 : state.performance === "balanced" ? 45 : 60);
    if (!force && state.playing && now - lastRender < frame) return;

    const rect = parent.getBoundingClientRect();
    // One device-independent pixel per 3 screen pixels, so the canvas stays blocky.
    const width = Math.max(280, Math.round((rect.width || window.innerWidth) / 3));
    const height = Math.max(180, Math.round((rect.height || window.innerHeight) / 3));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.imageSmoothingEnabled = false;

    const theme = state.theme;
    const light = /^#(f|e|d|c)/i.test(theme.backgroundColor) || theme.backgroundColor.includes("255");
    const ink = theme.primaryColor;
    const accent = theme.accentColor;
    const dim = paint(ink, light ? .48 : .5, "#9fb2c4");
    const scrim = paint(theme.backgroundColor, light ? .72 : .8, "#080b10");
    const time = Math.max(0, state.positionMs) / 1000;

    context.clearRect(0, 0, width, height);

    // A soft vertical scrim keeps the type readable without hiding the live background.
    const gradient = context.createLinearGradient(0, height * .28, 0, height * .96);
    gradient.addColorStop(0, paint(theme.backgroundColor, 0, "#080b10"));
    gradient.addColorStop(.34, scrim);
    gradient.addColorStop(1, scrim);
    context.fillStyle = gradient;
    context.fillRect(0, Math.round(height * .28), width, Math.round(height * .72));

    // Pixel grid + scanlines: the "bit" texture, drawn under the type.
    context.fillStyle = paint(ink, light ? .07 : .09, "#ffffff");
    for (let y = 0; y < height; y += 3) context.fillRect(0, y, width, 1);

    let active = -1;
    for (let i = 0; i < lines.length; i++) { if (lines[i].startTime <= time) active = i; else break; }
    const line = lines[Math.max(0, active)];
    const nextLine = lines[active + 1];
    const fontSize = Math.max(15, Math.min(34, Math.round(width / 23)));
    const leading = Math.round(fontSize * 1.36);
    const textWidth = width * .78;

    // Header strip: catalogue code, transport state, timecode.
    context.textAlign = "left";
    context.font = `700 ${Math.max(8, Math.round(width / 90))}px ui-monospace, 'Cascadia Mono', monospace`;
    context.fillStyle = paint(accent, .82, "#7fe1ff");
    // Phones overlay their own stage controls on the same strip.
    const headerTop = document.documentElement.dataset.mobile === "true" ? 58 : 22;
    context.fillText("TIDE // BIT-SIGNAL", 16, headerTop);
    context.fillStyle = paint(ink, .42, "#ffffff");
    context.fillText(state.playing ? "PLAY >>>" : "PAUSE ||", 16, headerTop + 14);
    context.textAlign = "right";
    context.fillStyle = paint(accent, .78, "#7fe1ff");
    context.fillText(`${Math.floor(time / 60).toString().padStart(2, "0")}:${Math.floor(time % 60).toString().padStart(2, "0")}`, width - 16, headerTop);

    // Corner brackets frame the composition the way a CRT overlay would.
    const bracket = Math.max(10, Math.round(width / 60));
    context.strokeStyle = paint(accent, .5, "#7fe1ff");
    context.lineWidth = 1;
    for (const [x, y, dx, dy] of [[12, headerTop + 24, 1, 1], [width - 12, headerTop + 24, -1, 1], [12, height - 16, 1, -1], [width - 12, height - 16, -1, -1]] as const) {
      context.beginPath();
      context.moveTo(x + dx * bracket, y);
      context.lineTo(x, y);
      context.lineTo(x, y + dy * bracket);
      context.stroke();
    }

    if (line) {
      context.font = `700 ${fontSize}px 'Microsoft YaHei', 'Yu Gothic', 'PingFang SC', system-ui, sans-serif`;
      const rows = wrap(line.fullText, textWidth).slice(0, 3);
      const blockTop = Math.round(height * .46 - (rows.length - 1) * leading / 2);

      // Keep the previous/next cue visible so the console reads like a lyric terminal.
      context.textAlign = "center";
      if (nextLine) {
        context.font = `600 ${Math.max(11, Math.round(fontSize * .56))}px 'Microsoft YaHei', 'Yu Gothic', system-ui, sans-serif`;
        context.fillStyle = paint(ink, .2, "#ffffff");
        context.fillText(wrap(nextLine.fullText, textWidth)[0] ?? "", width / 2, blockTop + rows.length * leading + Math.round(fontSize * .5));
      }

      context.font = `700 ${fontSize}px 'Microsoft YaHei', 'Yu Gothic', 'PingFang SC', system-ui, sans-serif`;
      let played = 0;
      for (const word of line.words) {
        const ratio = Math.max(0, Math.min(1, (time - word.startTime) / Math.max(.001, word.endTime - word.startTime)));
        played += Array.from(word.text).length * ratio;
      }
      let consumed = 0;
      rows.forEach((row, index) => {
        const baseline = blockTop + index * leading;
        const count = Array.from(row).length;
        const rowLeft = Math.round(width / 2 - context.measureText(row).width / 2);
        // Hard 1px drop shadow keeps the type legible over any stage background.
        context.fillStyle = paint(theme.backgroundColor, .9, "#000000");
        context.fillText(row, width / 2 + 1, baseline + 1);
        context.fillStyle = dim;
        context.fillText(row, width / 2, baseline);
        const partial = Math.max(0, Math.min(count, played - consumed));
        if (partial > 0) {
          const chars = Array.from(row);
          const whole = Math.floor(partial);
          const filled = context.measureText(chars.slice(0, whole).join("")).width
            + (chars[whole] ? context.measureText(chars[whole]).width * (partial - whole) : 0);
          context.save();
          context.beginPath();
          context.rect(rowLeft, baseline - fontSize, filled, Math.round(fontSize * 1.4));
          context.clip();
          context.fillStyle = accent;
          context.fillText(row, width / 2, baseline);
          context.restore();
        }
        consumed += count;
      });

      context.font = `500 ${Math.max(10, Math.round(fontSize * .5))}px 'Microsoft YaHei', 'Yu Gothic', system-ui, sans-serif`;
      const translation = line.translation || line.romanization || "";
      context.fillStyle = paint(ink, .66, "#c7d6e4");
      wrap(translation, textWidth).slice(0, 2).forEach((row, index) => {
        context.fillText(row, width / 2, blockTop + rows.length * leading + Math.round(fontSize * .95) + index * Math.round(fontSize * .58));
      });

      // Morse-like progress cells: filled cells are the played part of the line.
      const span = Math.max(.01, line.endTime - line.startTime);
      const progress = Math.max(0, Math.min(1, (time - line.startTime) / span));
      const cells = 40;
      const cellWidth = Math.max(2, Math.round((width * .56) / cells) - 2);
      const cellLeft = Math.round(width * .22);
      const cellTop = height - 26;
      for (let i = 0; i < cells; i++) {
        const on = i / cells < progress;
        context.fillStyle = on ? paint(accent, .9, "#7fe1ff") : paint(ink, .16, "#ffffff");
        context.fillRect(cellLeft + i * (cellWidth + 2), cellTop, cellWidth, 3);
      }
      // Equalizer bars driven by the same clock, quantized to whole pixels.
      context.fillStyle = paint(accent, .55, "#7fe1ff");
      for (let i = 0; i < 16; i++) {
        const barHeight = Math.max(1, Math.round((Math.sin(time * 2.4 + i * .7) * .5 + .5) * 7));
        context.fillRect(Math.round(width * .22) + i * 4, cellTop - barHeight - 4, 2, barHeight);
      }
    }

    lastPosition = state.positionMs; lastTheme = state.theme; lastRender = now;
    window.dispatchEvent(new CustomEvent("tide:lyric-stage-frame", { detail: { canvas, trackId: state.trackId, pack: "pixel-bit", positionMs: state.positionMs } }));
  };

  const safeRender = (force = false) => { try { render(force); } catch (error) { onError?.(error); } };
  const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => safeRender(true)) : null;
  resize?.observe(parent);
  safeRender(true);
  return {
    ready: context ? Promise.resolve() : Promise.reject(new Error("Pixel stage canvas unavailable")),
    update(next) { state = next; safeRender(); },
    setVisible(next) { visible = next; host.hidden = !next; if (next) safeRender(true); },
    async captureFrame() { if (destroyed || !context) return null; safeRender(true); return canvas.toDataURL("image/png"); },
    destroy() { destroyed = true; resize?.disconnect(); host.remove(); canvas.width = canvas.height = 0; },
  };
}
