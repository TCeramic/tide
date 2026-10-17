/** A themed close menu; hiding audio's window never exits playback. */
export function mountCloseMenu(): () => void {
  let menu: HTMLElement | null = null;
  let focusBefore: HTMLElement | null = null;
  const close = () => { menu?.remove(); menu = null; focusBefore?.focus({ preventScroll: true }); };
  const decide = (action: "tray" | "quit" | "cancel") => { close(); void window.tide.windowAction(action); };
  const open = () => {
    if (menu) return;
    focusBefore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menu = document.createElement("div"); menu.className = "window-close-backdrop";
    const panel = document.createElement("section"); panel.className = "window-close-menu";
    // Lens loads its surface rules dynamically; keep viewport anchoring independent
    // of the generic .lg-surface { position:relative } rule and module transforms.
    panel.style.cssText = "position:fixed;inset:42px 18px auto auto;max-height:calc(100dvh - 60px);overflow:auto;transform:none";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "关闭 Tide"); panel.setAttribute("aria-modal", "true");
    const heading = document.createElement("h2"); heading.textContent = "离开 Tide";
    const text = document.createElement("p"); text.textContent = "收起后音乐和桌面歌词会继续播放。";
    panel.append(heading, text);
    for (const [label, action] of [["收起到系统托盘", "tray"], ["退出 Tide", "quit"], ["取消", "cancel"]] as const) {
      const button = document.createElement("button"); button.type = "button"; button.className = "text-button"; button.textContent = label;
      button.addEventListener("click", () => decide(action)); panel.append(button);
    }
    menu.append(panel); document.body.append(menu);
    menu.addEventListener("pointerdown", event => { if (event.target === menu) decide("cancel"); });
    panel.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); decide("cancel"); }
      if (event.key === "Tab") {
        const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>("button"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    });
    panel.querySelector("button")?.focus({ preventScroll: true });
  };
  const stop = window.tide.onCloseRequest?.(open);
  return () => { stop?.(); close(); };
}
