import type { DeskLyricsSettings } from "../../core/desk-lyrics";

/** Settings block for the desktop lyric overlay. */
export function mountDeskForm(): { element: HTMLElement; destroy: () => void } {
  const panel = document.createElement("details");
  panel.className = "key-panel";
  const summary = document.createElement("summary");
  summary.textContent = "桌面歌词";

  const help = document.createElement("p");
  help.className = "library-note";
  help.textContent = "独立透明窗口，置顶在其它窗口之上。锁定后点击会穿透到下层。用 Ctrl+Alt+L 锁定或解锁。";

  const openRow = checkRow("桌面歌词");
  const lockRow = checkRow("锁定（点击穿透）");
  const sizeRow = rangeRow("字号", 18, 64, 32);
  const colorRow = colorRowOf();
  const opacityRow = rangeRow("透明度", 20, 100, 100);

  panel.append(summary, help, openRow.row, lockRow.row, sizeRow.row, colorRow.row, opacityRow.row);

  const paint = (settings: DeskLyricsSettings) => {
    openRow.input.checked = settings.open;
    lockRow.input.checked = settings.locked;
    lockRow.input.disabled = !settings.open;
    sizeRow.input.value = String(settings.fontSize);
    colorRow.input.value = settings.color;
    opacityRow.input.value = String(Math.round(settings.opacity * 100));
  };

  const push = (patch: Partial<DeskLyricsSettings>) => {
    void window.tide.setDeskLyrics(patch).then(paint);
  };

  openRow.input.addEventListener("change", () => push({ open: openRow.input.checked }));
  lockRow.input.addEventListener("change", () => push({ locked: lockRow.input.checked }));
  sizeRow.input.addEventListener("change", () => push({ fontSize: Number(sizeRow.input.value) }));
  colorRow.input.addEventListener("change", () => push({ color: colorRow.input.value }));
  opacityRow.input.addEventListener("change", () => push({ opacity: Number(opacityRow.input.value) / 100 }));

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

function colorRowOf(): { row: HTMLLabelElement; input: HTMLInputElement } {
  const row = document.createElement("label");
  row.className = "key-row";
  const text = document.createElement("span");
  text.textContent = "字色";
  const input = document.createElement("input");
  input.type = "color";
  input.value = "#f7fbfc";
  input.setAttribute("aria-label", "字色");
  row.append(text, input);
  return { row, input };
}
