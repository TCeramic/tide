let closeCurrent: (() => void) | null = null;

/** One detached overlay: opening a menu never changes a song row's height. */
export function openTrackMenu(menu: HTMLElement, anchor: HTMLElement, point?: { x: number; y: number }): void {
  if (!point && menu.isConnected && !menu.hidden) { closeCurrent?.(); return; }
  closeCurrent?.();
  const abort = new AbortController(), { signal } = abort;
  const previousFocus = document.activeElement;
  menu.hidden = false; menu.classList.add("track-context-menu");
  menu.setAttribute("role", "dialog"); menu.setAttribute("aria-label", "曲目操作");
  anchor.setAttribute("aria-expanded", "true");
  document.body.append(menu);
  const bounds = anchor.getBoundingClientRect(), box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8,Math.min(point?.x ?? bounds.right-box.width, innerWidth-box.width-8))}px`;
  menu.style.top = `${Math.max(8,Math.min(point?.y ?? bounds.bottom+6, innerHeight-box.height-8))}px`;
  const close = () => {
    abort.abort(); observer.disconnect(); menu.remove(); menu.hidden = true;
    anchor.setAttribute("aria-expanded", "false");
    if (closeCurrent === close) closeCurrent = null;
  };
  const observer = new MutationObserver(() => { if (!anchor.isConnected) close(); });
  observer.observe(document.body,{childList:true,subtree:true});
  closeCurrent = close;
  document.addEventListener("pointerdown", event => { if (!menu.contains(event.target as Node) && !anchor.contains(event.target as Node)) close(); }, { capture:true, signal });
  document.addEventListener("focusin", event => { if (!menu.contains(event.target as Node) && !anchor.contains(event.target as Node)) close(); }, { signal });
  window.addEventListener("resize", close, { signal });
  document.addEventListener("scroll", event => { if (!menu.contains(event.target as Node)) close(); }, { capture:true, signal });
  menu.addEventListener("click", event => { if ((event.target as Element).closest("button")) close(); }, { signal });
  menu.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({preventScroll:true}); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if ((event.target as HTMLElement).matches("select")) return;
      const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault(); buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }, { signal });
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({preventScroll:true});
}
