import type { DeskLyricsSettings } from "../../core/desk-lyrics";

/** Settings block for the desktop lyric overlay. */
export function mountDeskForm(): { element: HTMLElement; destroy: () => void } {
  const panel = document.createElement("details");
  panel.className = "key-panel desk-form";
  const summary = document.createElement("summary");
  summary.textContent = "桌面歌词";

  const center=document.createElement("button");center.type="button";center.className="text-button";center.textContent="居中桌面歌词";center.onclick=()=>void window.tide.centerDeskLyrics();
  const openRow = checkRow("桌面歌词");
  const lockRow = checkRow("锁定");
  const sweepRow = checkRow("字内扫过");
  const motionRow = checkRow("动效");
  const pairRow = checkRow("显示小字翻译");
  const waveRow = checkRow("字后波形");
  const columnRow = checkRow("竖列");
  const lineRow=document.createElement("label");lineRow.className="key-row";const lineLabel=document.createElement("span");lineLabel.textContent="原文行数";const lines=document.createElement("select");lines.setAttribute("aria-label","原文行数");for(const [value,label]of [["single","单行"],["double","双行"]]){const option=document.createElement("option");option.value=value!;option.textContent=label!;lines.append(option);}lineRow.append(lineLabel,lines);
  const shortcutRow=document.createElement("label");shortcutRow.className="key-row";const shortcutLabel=document.createElement("span");shortcutLabel.textContent="显隐热键";const shortcut=document.createElement("input");shortcut.className="key-input";shortcut.placeholder="Ctrl+Alt+D";shortcut.setAttribute("aria-label","桌面歌词显隐热键");shortcutRow.append(shortcutLabel,shortcut);
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

  const group = (title: string, ...rows: HTMLElement[]) => {
    const section = document.createElement("section"); section.className = "desk-group";
    const heading = document.createElement("h3"); heading.textContent = title;
    section.append(heading, ...rows); return section;
  };
  panel.append(summary,
    group("显示", openRow.row, lockRow.row, lineRow, pairRow.row, columnRow.row, shortcutRow, center),
    group("文字", fontRow, family, sizeRow.row, colorRow.row, highlightRow.row, opacityRow.row),
    group("效果", sweepRow.row, motionRow.row, waveRow.row, glowRow.row, motionLevelRow.row, backdropRow.row));

  const paint = (settings: DeskLyricsSettings) => {
    openRow.input.checked = settings.open;
    lockRow.input.checked = settings.locked;
    lockRow.input.disabled = !settings.open;
    sweepRow.input.checked = settings.highlightFollow;
    motionRow.input.checked = settings.motion;
    pairRow.input.checked = settings.pair;
    lines.value=settings.lineMode;
    if(document.activeElement!==shortcut)shortcut.value=settings.toggleShortcut;
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
    for (const control of [sizeRow, opacityRow, glowRow, motionLevelRow, backdropRow]) control.refresh();
  };

  const push = (patch: Partial<DeskLyricsSettings>) => {
    void window.tide.setDeskLyrics(patch).then(paint);
  };

  openRow.input.addEventListener("change", () => push({ open: openRow.input.checked }));
  lockRow.input.addEventListener("change", () => push({ locked: lockRow.input.checked }));
  sweepRow.input.addEventListener("change", () => push({ highlightFollow: sweepRow.input.checked }));
  motionRow.input.addEventListener("change", () => push({ motion: motionRow.input.checked }));
  lines.addEventListener("change",()=>push({lineMode:lines.value==="double"?"double":"single"}));
  shortcut.addEventListener("change",()=>push({toggleShortcut:shortcut.value.trim()}));
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
  row.append(text, input);
  return { row, input };
}

function rangeRow(label: string, min: number, max: number, value: number): { row: HTMLLabelElement; input: HTMLInputElement; refresh: () => void } {
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
  row.classList.add("desk-range");
  const output = document.createElement("output"); output.setAttribute("aria-hidden", "true");
  const refresh = () => { output.textContent = input.value + (label === "字号" ? "" : "%"); };
  input.addEventListener("input", refresh); refresh();
  row.append(text, input, output);
  return { row, input, refresh };
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
