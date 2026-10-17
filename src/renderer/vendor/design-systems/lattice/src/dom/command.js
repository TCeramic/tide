// ⌘K Command palette — commands are rows; the active row is marked by a small swarm that flows
// between rows as you move. Toasts arrive as dot-matrix tags that reflow into their message.
import { sound } from "../core/sound.js";
import { Dots, css, mountCanvas, animateWhileVisible } from "./dotkit.js";
import { mountDotText } from "./dottext.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** @param {{id:string, key:string, en:string, zh?:string, hint?:string, run:()=>void}[]} commands */
export function mountCommands(commands) {
  const dlg = document.createElement("dialog");
  dlg.className = "lx-cmd";
  dlg.setAttribute("aria-label", "Command palette");
  dlg.innerHTML = `
    <form method="dialog" class="lx-cmd__panel">
      <div class="lx-cmd__field"><span class="lx-cmd__key matrix" aria-hidden="true">⌘K</span>
        <input type="text" role="combobox" aria-expanded="true" aria-controls="lx-cmd-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Type a command"/></div>
      <div class="lx-cmd__list-wrap"><ul id="lx-cmd-list" role="listbox" class="lx-cmd__list"></ul></div>
      <p class="lx-cmd__foot"><span>↑↓ move</span><span>↵ run</span><span>esc close</span></p>
    </form>`;
  document.body.appendChild(dlg);
  const input = dlg.querySelector("input"), list = dlg.querySelector("ul"), wrap = dlg.querySelector(".lx-cmd__list-wrap");
  const { g, size } = mountCanvas(wrap);
  const marker = new Dots(18);
  marker.k = 150; marker.damp = 13;
  let items = [], active = 0;

  const score = (c, q) => {
    if (!q) return 1;
    const hay = `${c.en} ${c.zh || ""} ${c.hint || ""}`.toLowerCase();
    let k = 0;
    for (const ch of hay) if (ch === q[k]) k++;
    return k === q.length ? 1 + (hay.includes(q) ? 1 : 0) : 0;
  };
  const render = () => {
    const q = input.value.trim().toLowerCase();
    items = commands.map((c) => [score(c, q), c]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).map(([, c]) => c);
    active = Math.min(active, Math.max(0, items.length - 1));
    list.innerHTML = items.length
      ? items.map((c, i) => `<li role="option" id="lx-cmd-${c.id}" data-i="${i}" aria-selected="${i === active}"><span class="lx-cmd__glyph matrix" aria-hidden="true">${esc(c.key)}</span><span class="lx-cmd__en">${esc(c.en)}</span>${c.zh ? `<span class="lx-cmd__zh" lang="zh">${esc(c.zh)}</span>` : ""}${c.hint ? `<span class="lx-cmd__hint">${esc(c.hint)}</span>` : ""}</li>`).join("")
      : `<li class="lx-cmd__empty" role="presentation">No command matches “${esc(input.value)}”. Try “tree”, “sound” or “lorenz”.</li>`;
    input.setAttribute("aria-activedescendant", items[active] ? `lx-cmd-${items[active].id}` : "");
    placeMarker();
  };
  const placeMarker = () => {
    const li = list.querySelector(`[data-i="${active}"]`);
    if (!li) return;
    const wb = wrap.getBoundingClientRect(), lb = li.getBoundingClientRect();
    const cy = lb.top - wb.top + lb.height / 2, x0 = 8;
    for (let i = 0; i < marker.n; i++) { const c = i % 3, r = Math.floor(i / 3); marker.home(i, x0 + c * 4, cy - 10 + r * 4, 1); }
    marker.stagger(0.12, (i) => marker.ty[i]);
  };
  const run = (i) => { const c = items[i]; if (!c) return; sound.pluck(5, 0.18); dlg.close(); c.run(); };
  input.addEventListener("input", () => { active = 0; render(); sound.tick(1.5, 0.12); });
  input.addEventListener("keydown", (e) => {
    const n = Math.max(1, items.length);
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % n; render(); sound.tick(1.2, 0.1); }
    if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + n) % n; render(); sound.tick(1.2, 0.1); }
    if (e.key === "Enter") { e.preventDefault(); run(active); }
  });
  list.addEventListener("click", (e) => { const li = e.target.closest("[data-i]"); if (li) run(+li.dataset.i); });
  list.addEventListener("pointermove", (e) => { const li = e.target.closest("[data-i]"); if (li && +li.dataset.i !== active) { active = +li.dataset.i; render(); } });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  animateWhileVisible(wrap, (dt) => {
    if (!dlg.open) return;
    marker.step(dt);
    g.clearRect(0, 0, size.w, size.h);
    marker.draw(g, { ink: css("--hot"), hot: css("--hot"), r: 1.3 });
  });
  const open = () => {
    if (dlg.open) return;
    input.value = ""; active = 0;
    dlg.showModal();
    render();
    for (let i = 0; i < marker.n; i++) marker.place(i, 8 + Math.random() * 20, Math.random() * 60);
    input.focus();
    sound.whoosh(0.4, true);
  };
  addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); dlg.open ? dlg.close() : open(); } });
  return { open, close: () => dlg.close() };
}

let host;
/** Toast: a dot-matrix tag reflows into place beside the message. */
export function toast(message, { tag = "OK", ms = 2800 } = {}) {
  if (!host) {
    host = document.createElement("div");
    host.className = "lx-toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = "lx-toast";
  t.innerHTML = `<span class="lx-toast__tag">${esc(tag)}</span><span class="lx-toast__msg">${esc(message)}</span>`;
  host.appendChild(t);
  mountDotText(t.querySelector(".lx-toast__tag"), { pitch: 3 });
  sound.pluck(3, 0.14);
  setTimeout(() => { t.classList.add("is-leaving"); setTimeout(() => t.remove(), 600); }, ms);
}
