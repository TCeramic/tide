// Label layer — crisp DOM text pinned to 3D points (text never lives only inside WebGL).
export class LabelLayer {
  constructor(className = "fx-labels") {
    this.el = document.createElement("div");
    this.el.className = className;
    this.el.setAttribute("aria-hidden", "true");
    document.body.appendChild(this.el);
    this.items = new Map();
  }
  get(id, html, cls = "") {
    let it = this.items.get(id);
    if (!it) {
      const e = document.createElement("span");
      e.className = `fx-label ${cls}`;
      e.innerHTML = html;
      this.el.appendChild(e);
      it = { e, o: -1, x: 0, y: 0 };
      this.items.set(id, it);
    }
    return it;
  }
  place(id, x, y, opacity) {
    const it = this.items.get(id);
    if (!it) return;
    if (Math.abs(it.x - x) > 0.3 || Math.abs(it.y - y) > 0.3) { it.e.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; it.x = x; it.y = y; }
    const o = Math.round(opacity * 100) / 100;
    if (o !== it.o) { it.e.style.opacity = String(o); it.e.style.visibility = o < 0.02 ? "hidden" : "visible"; it.o = o; }
  }
  cls(id, name, on) { this.items.get(id)?.e.classList.toggle(name, on); }
  hideAll() { for (const [id] of this.items) this.place(id, -999, -999, 0); }
  clear() { this.el.innerHTML = ""; this.items.clear(); }
}
