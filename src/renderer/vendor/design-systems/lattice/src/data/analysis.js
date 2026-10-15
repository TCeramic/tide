// A dependency DAG for undergraduate real analysis, from the axioms of set theory to existence
// theorems for ODEs. deps = the results a standard proof uses directly. topic groups the waterfall.
// `leaf: true` marks where a proof tree stops (the axioms of ℝ as a complete ordered field and below).

export const TOPICS = {
  found: { en: "Foundations", zh: "基础" },
  seq: { en: "Sequences", zh: "数列" },
  cont: { en: "Continuity", zh: "连续" },
  diff: { en: "Differentiation", zh: "微分" },
  int: { en: "Integration", zh: "积分" },
  func: { en: "Series of functions", zh: "函数项级数" },
  metric: { en: "Metric spaces & ODE", zh: "度量空间与常微分方程" },
};

export const THEOREMS = [
  { id: "zfc", topic: "found", kind: "axiom", en: "ZFC", zh: "ZFC 公理系统", st: "Zermelo–Fraenkel set theory with Choice: every object below is a set built from these axioms.", deps: [], leaf: true },
  { id: "nat", topic: "found", kind: "construction", en: "ℕ and induction", zh: "自然数与归纳法", st: "ℕ is the least inductive set ω; any property closed under successor and true at 0 holds for all n.", deps: ["zfc"], leaf: true },
  { id: "rat", topic: "found", kind: "construction", en: "ℤ and ℚ", zh: "整数与有理数", st: "ℤ and ℚ are built as equivalence classes of pairs; ℚ is an ordered field.", deps: ["nat"], leaf: true },
  { id: "real", topic: "found", kind: "construction", en: "ℝ by Dedekind cuts", zh: "实数的构造", st: "The set of Dedekind cuts of ℚ, with the induced operations and order, is an ordered field ℝ.", deps: ["rat"], leaf: true },
  { id: "lub", topic: "found", kind: "theorem", en: "Completeness", zh: "确界原理", st: "Every nonempty subset of ℝ that is bounded above has a least upper bound.", deps: ["real"], leaf: true },
  { id: "archimedes", topic: "found", kind: "theorem", en: "Archimedean property", zh: "阿基米德性质", st: "For every real x there is a natural number n with n > x.", deps: ["lub", "nat"] },
  { id: "density", topic: "found", kind: "theorem", en: "Density of ℚ", zh: "有理数的稠密性", st: "Between any two distinct real numbers there is a rational number.", deps: ["archimedes", "rat"] },

  { id: "seqlimit", topic: "seq", kind: "definition", en: "Limit of a sequence", zh: "数列极限", st: "aₙ → L iff for every ε > 0 there is N such that |aₙ − L| < ε for all n ≥ N.", deps: ["real"] },
  { id: "limitlaws", topic: "seq", kind: "theorem", en: "Algebra of limits", zh: "极限的四则运算", st: "Limits respect sums, products, and quotients whose denominator has a nonzero limit.", deps: ["seqlimit"] },
  { id: "mct", topic: "seq", kind: "theorem", en: "Monotone convergence", zh: "单调收敛定理", st: "A bounded monotone sequence of reals converges, to its supremum or infimum.", deps: ["lub", "seqlimit"] },
  { id: "nested", topic: "seq", kind: "theorem", en: "Nested intervals", zh: "闭区间套定理", st: "A decreasing sequence of nonempty closed bounded intervals has nonempty intersection.", deps: ["mct"] },
  { id: "bw", topic: "seq", kind: "theorem", en: "Bolzano–Weierstrass", zh: "致密性定理", st: "Every bounded sequence of reals has a convergent subsequence.", deps: ["mct"] },
  { id: "cauchy", topic: "seq", kind: "theorem", en: "Cauchy criterion", zh: "柯西收敛准则", st: "A sequence of reals converges if and only if it is Cauchy.", deps: ["bw"] },
  { id: "series", topic: "seq", kind: "theorem", en: "Tests for series", zh: "级数判别法", st: "Comparison, ratio and root tests; an absolutely convergent series converges.", deps: ["mct", "cauchy"] },

  { id: "continuity", topic: "cont", kind: "definition", en: "Continuity (ε–δ)", zh: "连续性", st: "f is continuous at c iff for every ε > 0 there is δ > 0 with |f(x) − f(c)| < ε whenever |x − c| < δ; equivalently f(xₙ) → f(c) whenever xₙ → c.", deps: ["seqlimit"] },
  { id: "ivt", topic: "cont", kind: "theorem", en: "Intermediate value theorem", zh: "介值定理", st: "A continuous function on [a, b] takes every value between f(a) and f(b).", deps: ["lub", "continuity"] },
  { id: "evt", topic: "cont", kind: "theorem", en: "Extreme value theorem", zh: "最值定理", st: "A continuous function on [a, b] is bounded and attains its maximum and minimum.", deps: ["bw", "continuity"] },
  { id: "heinecantor", topic: "cont", kind: "theorem", en: "Heine–Cantor", zh: "一致连续性定理", st: "A continuous function on a closed bounded interval is uniformly continuous.", deps: ["bw", "continuity"] },
  { id: "heineborel", topic: "cont", kind: "theorem", en: "Heine–Borel", zh: "有限覆盖定理", st: "A subset of ℝ is compact (every open cover has a finite subcover) iff it is closed and bounded.", deps: ["nested"] },

  { id: "deriv", topic: "diff", kind: "definition", en: "Derivative", zh: "导数", st: "f′(c) = lim_{x→c} (f(x) − f(c))/(x − c) when the limit exists; differentiable functions are continuous.", deps: ["continuity", "limitlaws"] },
  { id: "fermat", topic: "diff", kind: "theorem", en: "Fermat's interior extremum", zh: "费马引理", st: "If f has a local extremum at an interior point c where f′(c) exists, then f′(c) = 0.", deps: ["deriv"] },
  { id: "rolle", topic: "diff", kind: "theorem", en: "Rolle's theorem", zh: "罗尔定理", st: "If f is continuous on [a, b], differentiable on (a, b) and f(a) = f(b), then f′(c) = 0 for some c ∈ (a, b).", deps: ["evt", "fermat"] },
  { id: "mvt", topic: "diff", kind: "theorem", en: "Mean value theorem", zh: "拉格朗日中值定理", st: "Under the same hypotheses without f(a) = f(b): f(b) − f(a) = f′(c)(b − a) for some c ∈ (a, b).", deps: ["rolle"] },
  { id: "cmvt", topic: "diff", kind: "theorem", en: "Cauchy mean value theorem", zh: "柯西中值定理", st: "(f(b) − f(a)) g′(c) = (g(b) − g(a)) f′(c) for some c ∈ (a, b).", deps: ["rolle"] },
  { id: "lhopital", topic: "diff", kind: "theorem", en: "L'Hôpital's rule", zh: "洛必达法则", st: "If f(x), g(x) → 0 as x → c, g′ ≠ 0 near c, and f′/g′ → L, then f/g → L.", deps: ["cmvt"] },
  { id: "taylor", topic: "diff", kind: "theorem", en: "Taylor's theorem", zh: "泰勒定理", st: "If f is n + 1 times differentiable: f(x) = Σ_{k≤n} f⁽ᵏ⁾(a)(x − a)ᵏ/k! + f⁽ⁿ⁺¹⁾(ξ)(x − a)ⁿ⁺¹/(n + 1)! for some ξ between a and x.", deps: ["rolle"] },

  { id: "riemann", topic: "int", kind: "definition", en: "Riemann integral", zh: "黎曼积分", st: "A bounded f is integrable on [a, b] iff the supremum of its lower Darboux sums equals the infimum of its upper sums.", deps: ["lub"] },
  { id: "intcont", topic: "int", kind: "theorem", en: "Continuous ⇒ integrable", zh: "连续函数可积", st: "Every continuous function on [a, b] is Riemann integrable.", deps: ["riemann", "heinecantor"] },
  { id: "ftc1", topic: "int", kind: "theorem", en: "Fundamental theorem I", zh: "微积分基本定理 I", st: "If f is continuous on [a, b], then F(x) = ∫ₐˣ f is differentiable and F′ = f.", deps: ["intcont", "deriv"] },
  { id: "ftc2", topic: "int", kind: "theorem", en: "Fundamental theorem II", zh: "牛顿–莱布尼茨公式", st: "If F′ = f on [a, b] and f is integrable, then ∫ₐᵇ f = F(b) − F(a).", deps: ["mvt", "riemann"] },

  { id: "uniform", topic: "func", kind: "theorem", en: "Uniform limit theorem", zh: "一致收敛保持连续", st: "A uniform limit of continuous functions is continuous.", deps: ["continuity", "seqlimit"] },
  { id: "mtest", topic: "func", kind: "theorem", en: "Weierstrass M-test", zh: "M 判别法", st: "If |fₙ| ≤ Mₙ and ΣMₙ converges, then Σfₙ converges uniformly.", deps: ["cauchy", "series"] },
  { id: "termint", topic: "func", kind: "theorem", en: "Term-by-term integration", zh: "逐项积分", st: "If fₙ → f uniformly on [a, b] and each fₙ is integrable, then ∫ f = lim ∫ fₙ.", deps: ["uniform", "riemann"] },
  { id: "powerseries", topic: "func", kind: "theorem", en: "Cauchy–Hadamard", zh: "幂级数收敛半径", st: "Σ aₙxⁿ converges absolutely for |x| < R = 1/limsup |aₙ|^{1/n}, uniformly on [−r, r] for every r < R.", deps: ["series", "mtest"] },
  { id: "termdiff", topic: "func", kind: "theorem", en: "Term-by-term differentiation", zh: "逐项求导", st: "Inside its radius a power series is differentiable, with derivative Σ n aₙ xⁿ⁻¹.", deps: ["powerseries", "mvt", "uniform"] },
  { id: "exp", topic: "func", kind: "construction", en: "exp, sin, cos", zh: "指数与三角函数", st: "Defined by power series; exp′ = exp and exp(x + y) = exp(x) exp(y).", deps: ["termdiff"] },
  { id: "wapprox", topic: "func", kind: "theorem", en: "Weierstrass approximation", zh: "魏尔斯特拉斯逼近定理", st: "Polynomials are uniformly dense in C[a, b]; Bernstein polynomials give an explicit sequence.", deps: ["heinecantor", "uniform"] },

  { id: "metric", topic: "metric", kind: "definition", en: "Metric spaces", zh: "度量空间", st: "A set with a distance d that is positive, symmetric and satisfies the triangle inequality; complete if Cauchy sequences converge.", deps: ["real"] },
  { id: "banach", topic: "metric", kind: "theorem", en: "Banach fixed-point theorem", zh: "巴拿赫不动点定理", st: "A contraction of a complete metric space has exactly one fixed point, the limit of its iterates.", deps: ["metric", "series"] },
  { id: "baire", topic: "metric", kind: "theorem", en: "Baire category theorem", zh: "贝尔纲定理", st: "A complete metric space is not a countable union of nowhere dense sets.", deps: ["metric", "cauchy"] },
  { id: "arzela", topic: "metric", kind: "theorem", en: "Arzelà–Ascoli", zh: "阿尔泽拉–阿斯科利定理", st: "A bounded, equicontinuous sequence in C[a, b] has a uniformly convergent subsequence.", deps: ["bw", "density", "uniform"] },
  { id: "picard", topic: "metric", kind: "theorem", en: "Picard–Lindelöf", zh: "皮卡–林德勒夫定理", st: "If f is continuous and Lipschitz in y, then y′ = f(t, y), y(t₀) = y₀ has a unique local solution.", deps: ["banach", "ftc1", "uniform"] },
  { id: "peano", topic: "metric", kind: "theorem", en: "Peano existence theorem", zh: "皮亚诺存在定理", st: "If f is continuous, then y′ = f(t, y), y(t₀) = y₀ has a local solution (not necessarily unique).", deps: ["arzela", "ftc1"] },
];

export const byId = new Map(THEOREMS.map((t) => [t.id, t]));

/** Longest-path depth from the axioms. */
export function depths() {
  const memo = new Map();
  const d = (id) => {
    if (memo.has(id)) return memo.get(id);
    const t = byId.get(id);
    const v = t.deps.length ? 1 + Math.max(...t.deps.map(d)) : 0;
    memo.set(id, v);
    return v;
  };
  THEOREMS.forEach((t) => d(t.id));
  return memo;
}
