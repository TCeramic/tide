// 声 Sound — synthesized, opt-in, quiet. Points click, sets crystallize in pentatonic plucks,
// morphs whoosh through filtered noise, and a finished proof rings a soft chord.
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

class Sound {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.subs = new Set();
    try { this.enabled = localStorage.getItem("lattice.sound") === "on"; } catch {}
  }
  _ctx() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.5;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    // a short synthetic room so plucks bloom a little
    const verb = this.ctx.createConvolver();
    const len = this.ctx.sampleRate * 1.4, buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    verb.buffer = buf;
    this.wet = this.ctx.createGain(); this.wet.gain.value = 0.22;
    this.out.connect(comp).connect(this.ctx.destination);
    this.out.connect(verb).connect(this.wet).connect(comp);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return this.ctx;
  }
  toggle(on = !this.enabled) {
    this.enabled = on;
    try { localStorage.setItem("lattice.sound", on ? "on" : "off"); } catch {}
    if (on) { this._ctx()?.resume(); this.pluck(4, 0.3); }
    this.subs.forEach((f) => f(on));
    return on;
  }
  onChange(f) { this.subs.add(f); }
  _ok() { return this.enabled && this._ctx(); }
  _env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }

  /** A dot: tiny filtered click. */
  tick(pitch = 1, gain = 0.25) {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 2600 * pitch; f.Q.value = 12;
    const g = c.createGain(); this._env(g, t, 0.001, gain, 0.03);
    s.connect(f).connect(g).connect(this.out); s.start(t); s.stop(t + 0.05);
  }
  /** A set crystallizing: plucked sine with a soft second partial; degree walks the pentatonic scale. */
  pluck(degree = 0, gain = 0.2) {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const f = 330 * Math.pow(2, PENTA[((degree % PENTA.length) + PENTA.length) % PENTA.length] / 12);
    [[1, 1, 0.9], [2, 0.25, 0.4], [3.01, 0.08, 0.2]].forEach(([m, a, d]) => {
      const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f * m;
      const g = c.createGain(); this._env(g, t, 0.003, gain * a, d);
      o.connect(g).connect(this.out); o.start(t); o.stop(t + d + 0.05);
    });
  }
  /** A morph: noise swept through a resonant band. */
  whoosh(dur = 0.9, up = true) {
    if (!this._ok()) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 5;
    f.frequency.setValueAtTime(up ? 300 : 2400, t);
    f.frequency.exponentialRampToValueAtTime(up ? 2400 : 300, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out); s.start(t); s.stop(t + dur + 0.05);
  }
  /** A finished proof: a soft stacked chord. */
  chord(root = 0) { [0, 2, 4].forEach((k, i) => setTimeout(() => this.pluck(root + k, 0.16), i * 70)); }
}

export const sound = new Sound();
