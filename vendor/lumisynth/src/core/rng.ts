// src/core/rng.ts
// 渲染路径里的随机数。包里原来直接调 Math.random，结果取决于场景的构建顺序与次数——预览时
// 邻段预构建、seek、重编都会改变它，逐帧导出也就和预览对不上。这里改成按 key 播种的流：
// 内核构建每个场景单元时用 `withRandomStream(key, build)` 圈定一个流，构建期间的 random()
// 都从这个流里取。
//
// 对照 folia 原版的渲染测试需要两边消耗同一个 Math.random 序列，所以留了一个开关
// `globalThis.__LUMI_NATIVE_RANDOM`：为 true 时 random() 直接转发给 Math.random。

const hashKey = (key: string) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i += 1) {
        hash ^= key.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

/** mulberry32：32 位状态，周期 2^32，对装饰用的随机足够。 */
export const createRng = (seed: string | number) => {
    let state = typeof seed === 'number' ? seed >>> 0 : hashKey(seed);
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/** 纯函数形式：同一个 (seed, key) 永远得到同一个值。 */
export const rng = (seed: string | number, key: string | number) => createRng(`${seed}::${key}`)();

let current: (() => number) | null = null;
const fallback = createRng('lumisynth:fallback');

const nativeRandomRequested = () => (globalThis as { __LUMI_NATIVE_RANDOM?: boolean }).__LUMI_NATIVE_RANDOM === true;

/** 取代 Math.random：在 withRandomStream 圈定的流里取值。 */
export const random = (): number => {
    if (nativeRandomRequested()) return Math.random();
    return (current ?? fallback)();
};

export const withRandomStream = <T>(key: string, run: () => T): T => {
    const previous = current;
    current = createRng(key);
    try {
        return run();
    } finally {
        current = previous;
    }
};

/**
 * 与 createRng(seed) 同一条流，但从第 skip 个值之后开始：mulberry32 每取一次状态加一个常数，跳过是 O(1)。
 * 绘光的歌词窗口按需构建某一行时用它直接跳到这一行的起点，拿到的值与从头顺序取完全一样。
 */
export const createRngAt = (seed: string | number, skip: number) => {
    const state = typeof seed === 'number' ? seed >>> 0 : hashKey(seed);
    return createRng((state + Math.imul(skip, 0x6d2b79f5)) >>> 0);
};
