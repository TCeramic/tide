// src/core/audio/fft.ts
// 就地基 2 FFT。长度必须是 2 的幂；re/im 被改写为频域结果。

const bitReverseTables = new Map<number, Uint32Array>();
const twiddleTables = new Map<number, { cos: Float64Array; sin: Float64Array }>();

const getBitReverse = (n: number) => {
    let table = bitReverseTables.get(n);
    if (table) return table;
    table = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i += 1) {
        let reversed = 0;
        for (let b = 0; b < bits; b += 1) reversed = (reversed << 1) | ((i >>> b) & 1);
        table[i] = reversed;
    }
    bitReverseTables.set(n, table);
    return table;
};

const getTwiddles = (n: number) => {
    let table = twiddleTables.get(n);
    if (table) return table;
    const half = n / 2;
    table = { cos: new Float64Array(half), sin: new Float64Array(half) };
    for (let i = 0; i < half; i += 1) {
        table.cos[i] = Math.cos((-2 * Math.PI * i) / n);
        table.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    twiddleTables.set(n, table);
    return table;
};

export const fft = (re: Float64Array, im: Float64Array) => {
    const n = re.length;
    if (n !== im.length || (n & (n - 1)) !== 0) throw new Error(`fft: length ${n} is not a power of two`);
    const reverse = getBitReverse(n);
    for (let i = 0; i < n; i += 1) {
        const j = reverse[i];
        if (j > i) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    const { cos, sin } = getTwiddles(n);
    for (let size = 2; size <= n; size <<= 1) {
        const half = size >> 1;
        const step = n / size;
        for (let start = 0; start < n; start += size) {
            for (let k = 0; k < half; k += 1) {
                const wr = cos[k * step];
                const wi = sin[k * step];
                const a = start + k;
                const b = a + half;
                const tr = re[b] * wr - im[b] * wi;
                const ti = re[b] * wi + im[b] * wr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
    }
};
