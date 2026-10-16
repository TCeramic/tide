import type { DeskLyricsSettings } from "../../core/desk-lyrics";

/** Settings block for the desktop lyric overlay. */
export function mountDeskForm(): { element: HTMLElement; destroy: () => void } {
  const panel = document.createElement("details");
  panel.className = "key-panel desk-form";
  const summary = document.createElement("summary");
  summary.textContent = "桌面歌词";

  const help = document.createElement("p");
  help.className = "library-note";
  help.textContent = "独立透明窗口，置顶在其它窗口之上。锁定后点击会穿透到下层。用 Ctrl+Alt+L 锁定或解锁。";

  const openRow = checkRow("桌面歌词");
  const lockRow = checkRow("锁定（点击穿透）");
  const sweepRow = checkRow("字内扫过");
  const motionRow = checkRow("动效");
  const pairRow = checkRow("双行译文");
  const waveRow = checkRow("字后波形");
  const columnRow = checkRow("竖列");
  const sizeRow = rangeRow("字号", 18, 64, 32);
  const colorRow = colorRowOf("未唱歌词颜色");
  const highlightRow = colorRowOf("已唱歌词颜色");
  const fontRow = document.createElement("label"); fontRow.className = "key-row";
  const fontLabel = document.createElement("span"); fontLabel.textContent = "歌词字体";
  const font = document.createElement("select"); font.setAttribute("aria-label", "歌词字体");
  for(const [value, label] of [["Microsoft YaHei","微软雅黑"],["SimSun","宋体"],["KaiTi","楷体"],["SimHei","黑体"],["Arial","Arial"],["serif","衬线"],["monospace","等宽"],["custom","自定义字体"]]) { const option = document.createElement("option"); option.value=value!;option.textContent=label!;font.append(option); }
  const family = document.createElement("input");family.type="text";family.maxLength=80;family.className="key-input";family.placeholder="输入已安装的字体名称";family.setAttribute("aria-label","桌面歌词自定义字体");
  fontRow.append(fontLabel,font);
  const opacityRow = rangeRow("透明度", 20, 100, 100);
  const glowRow = rangeRow("光晕", 0, 100, 72);
  const motionLevelRow = rangeRow("动效强度", 35, 100, 100);
  const backdropRow = rangeRow("背景", 0, 55, 0);

  panel.append(
    summary,
    help,
    openRow.row,
    lockRow.row,
    sweepRow.row,
    motionRow.row,
    pairRow.row,
    waveRow.row,
    columnRow.row,
    sizeRow.row,
    colorRow.row,
    highlightRow.row,
    fontRow, family,
    opacityRow.row,
    glowRow.row,
    motionLevelRow.row,
    backdropRow.row,
  );

  const paint = (settings: DeskLyricsSettings) => {
    openRow.input.checked = settings.open;
    lockRow.input.checked = settings.locked;
    lockRow.input.disabled = !settings.open;
    sweepRow.input.checked = settings.highlightFollow;
    motionRow.input.checked = settings.motion;
    pairRow.input.checked = settings.pair;
    waveRow.input.checked = settings.wave;
    columnRow.input.checked = settings.orientation === "vertical";
    sizeRow.input.value = String(settings.fontSize);
    colorRow.input.value = settings.color;
    highlightRow.input.value = settings.highlightColor;
    font.value = Array.from(font.options).some(o=>o.value===settings.fontFamily) ? settings.fontFamily : "custom";
    family.hidden = font.value !== "custom";
    if(document.activeElement!==family) family.value=settings.fontFamily;
    opacityRow.input.value = String(Math.round(settings.opacity * 100));
    glowRow.input.value = String(Math.round(settings.glow * 100));
    motionLevelRow.input.value = String(Math.round(settings.motionLevel * 100));
    backdropRow.input.value = String(Math.round(settings.backdrop * 100));
  };

  const push = (patch: Partial<DeskLyricsSettings>) => {
    void window.tide.setDeskLyrics(patch).then(paint);
  };

  openRow.input.addEventListener("change", () => push({ open: openRow.input.checked }));
  lockRow.input.addEventListener("change", () => push({ locked: lockRow.input.checked }));
  sweepRow.input.addEventListener("change", () => push({ highlightFollow: sweepRow.input.checked }));
  motionRow.input.addEventListener("change", () => push({ motion: motionRow.input.checked }));
  pairRow.input.addEventListener("change", () => push({ pair: pairRow.input.checked }));
  waveRow.input.addEventListener("change", () => push({ wave: waveRow.input.checked }));
  columnRow.input.addEventListener("change", () => push({ orientation: columnRow.input.checked ? "vertical" : "horizontal" }));
  sizeRow.input.addEventListener("change", () => push({ fontSize: Number(sizeRow.input.value) }));
  colorRow.input.addEventListener("change", () => push({ color: colorRow.input.value }));
  highlightRow.input.addEventListener("change", () => push({ highlightColor: highlightRow.input.value }));
  font.addEventListener("change",()=>{family.hidden=font.value!=="custom";if(font.value==="custom")family.focus();else push({fontFamily:font.value});});
  family.addEventListener("change",()=>push({fontFamily:family.value}));
  opacityRow.input.addEventListener("change", () => push({ opacity: Number(opacityRow.input.value) / 100 }));
  glowRow.input.addEventListener("change", () => push({ glow: Number(glowRow.input.value) / 100 }));
  motionLevelRow.input.addEventListener("change", () => push({ motionLevel: Number(motionLevelRow.input.value) / 100 }));
  backdropRow.input.addEventListener("change", () => push({ backdrop: Number(backdropRow.input.value) / 100 }));

  const stop = window.tide.onDeskState(paint);
  void window.tide.getDeskLyrics().then(paint);

  return {
    element: panel,
    destroy: () => {
      stop();
      panel.remove();
    },
  };
}

function checkRow(label: string): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = document.createElement("label");
  row.className = "key-capture";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("aria-label", label);
  const text = document.createElement("span");
  text.textContent = label;
  row.append(input, text);
  return { row, input };
}

function rangeRow(label: string, min: number, max: number, value: number): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = document.createElement("label");
  row.className = "key-row";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  input.setAttribute("aria-label", label);
  row.append(text, input);
  return { row, input };
}

function colorRowOf(label: string): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = document.createElement("label");
  row.className = "key-row";
  const text = document.createElement("span");
  text.textContent = label;
  const input = document.createElement("input");
  input.type = "color";
  input.value = "#f7fbfc";
  input.setAttribute("aria-label", label);
  row.append(text, input);
  return { row, input };
}
