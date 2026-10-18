// Deterministic surface samples. No per-frame allocations or random rebuilding.
export const TIDE_SHAPES = [
  ["saturn", "SATURN"], ["helix", "DNA DOUBLE HELIX"], ["shell", "NAUTILUS"],
  ["heart", "HEART"], ["orbit", "ORBIT"], ["mobius", "MOBIUS RIBBON"],
  ["jellyfish", "JELLYFISH"], ["galaxy", "SPIRAL GALAXY"],
  ["manta", "MANTA RAY"], ["bloom", "COSMIC BLOOM"], ["butterfly", "BUTTERFLY"],
] as const;
const TAU = Math.PI * 2;
const fract = (n: number) => n - Math.floor(n);
export function tideShape(n: number, kind: string): Float32Array {
  const a = new Float32Array(n * 3), golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const u = (i + .5) / n, t = i * golden, v = 2 * u - 1;
    const q = fract(i * .61803398875), w = fract(i * .75487766625);
    const r = Math.sqrt(1 - v * v);
    let x: number, y: number, z: number;
    if (kind === 'saturn') {
      if (i % 3 === 0) { const ring = 1.45 + .35 * q; x = ring * Math.cos(t); z = ring * Math.sin(t); y = .14 * z; }
      else { x = r * Math.cos(t); y = v; z = r * Math.sin(t); }
    } else if (kind === 'helix') {
      // Two continuous backbones, connected by 25 paired base rungs.
      const rung = i % 5 >= 3, h = rung ? Math.floor(u * 25) / 24 : u;
      const angle = h * TAU * 2.5, tube = .045;
      const side = i % 2 ? 1 : -1, along = rung ? (q * 2 - 1) : side;
      x = .76 * Math.cos(angle) * along + tube * Math.cos(t);
      y = (h * 2 - 1) * 1.65 + tube * Math.sin(t);
      z = .76 * Math.sin(angle) * along + tube * Math.sin(t * 1.7);
    } else if (kind === 'shell') {
      const h = u * Math.PI * 12, s = .15 + u * 1.7;
      x = s * Math.cos(h); y = (u - .5) * 2; z = s * Math.sin(h);
    } else if (kind === 'heart') {
      const h = u * TAU;
      x = 16 * Math.sin(h) ** 3 / 10;
      y = (13 * Math.cos(h) - 5 * Math.cos(2*h) - 2 * Math.cos(3*h) - Math.cos(4*h)) / 10;
      z = Math.sin(t) * .18 * (1 - Math.abs(x) / 2);
    } else if (kind === 'mobius') {
      const h = u * TAU, strip = (q - .5) * .95, radius = 1.15 + strip * Math.cos(h / 2);
      x = radius * Math.cos(h); y = strip * Math.sin(h / 2); z = radius * Math.sin(h);
    } else if (kind === 'jellyfish') {
      if (i % 10 < 6) {
        const h = q * TAU, cap = Math.acos(w), s = 1.15 * Math.sin(cap);
        x = s * Math.cos(h); z = s * Math.sin(h); y = .35 + .85 * Math.cos(cap) + .04 * Math.cos(h * 12);
      } else {
        const h = (i % 12) / 12 * TAU, s = .58 + .16 * Math.sin(u * 15 + h);
        x = s * Math.cos(h) + .12 * Math.sin(u * 17 + h);
        z = s * Math.sin(h) + .12 * Math.cos(u * 14 + h); y = .35 - u * 2;
      }
    } else if (kind === 'galaxy') {
      const radius = .12 + 1.7 * Math.sqrt(u), arm = i % 5;
      const angle = arm / 5 * TAU + 4.4 * (1 - Math.sqrt(u)) + (q - .5) * .3;
      x = radius * Math.cos(angle); z = radius * Math.sin(angle);
      y = (w - .5) * (.35 * Math.exp(-u * 6) + .07);
    } else if (kind === 'manta') {
      const across = v, forward = (q * 2 - 1), wing = Math.sqrt(Math.max(0, 1 - across * across));
      x = across * 1.8; z = forward * wing * .8 + Math.abs(across) * .55;
      y = .35 * Math.sin(Math.abs(across) * Math.PI * 1.2) + .14 * Math.cos(forward * Math.PI) * wing;
      if (i % 9 === 0) { x = .06 * Math.sin(u * 12); z = .6 + u * 1.3; y = -.15 - .25 * u; }
    } else if (kind === 'bloom') {
      const h = u * TAU, p = q * TAU, radius = 1 + .38 * Math.cos(h * 6);
      x = (radius + .24 * Math.cos(p)) * Math.cos(h);
      z = (radius + .24 * Math.cos(p)) * Math.sin(h);
      y = .4 * Math.sin(h * 3) + .24 * Math.sin(p);
    } else if (kind === 'butterfly') {
      const h = u * Math.PI * 12;
      const s = (Math.exp(Math.cos(h)) - 2 * Math.cos(4 * h) - Math.sin(h / 12) ** 5) * .43;
      x = s * Math.sin(h); y = s * Math.cos(h);
      z = .38 * Math.sin(Math.abs(x) * 1.6) + .06 * Math.cos(t);
    } else {
      const h = u * TAU;
      x = 1.2 * Math.sin(h * 3 + .7) * Math.cos(t); y = 1.2 * Math.sin(h * 2); z = 1.2 * Math.cos(h * 3 + .7) * Math.sin(t);
    }
    a.set([x, y, z], i * 3);
  }
  return a;
}
