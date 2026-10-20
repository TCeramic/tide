// src/app/timeline/reveal.ts
// 「在时间轴上显示」：大纲、面包屑、剧本里点一项（导航），时间轴把这一项的时间范围滚进视野。
// 时间轴自己的点击不走这里（点的东西本来就在眼前，滚走反而找不到）。时间轴没打开时什么也不做。
type Listener = (range: { start: number; end: number }) => void;

const listeners = new Set<Listener>();

export const revealInTimeline = (start: number, end = start) => {
    const range = { start: Math.min(start, end), end: Math.max(start, end) };
    listeners.forEach(listener => listener(range));
};

export const onRevealInTimeline = (listener: Listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/**
 * 滚到哪里：已经完整可见就不动；放得下就居中；放不下就让开头靠左（留一点边）。
 * 返回新的 scrollLeft，不用滚时返回 null。x 都是内容里的像素。
 */
export const revealScroll = (scrollLeft: number, viewport: number, from: number, to: number, contentWidth: number): number | null => {
    const margin = Math.min(40, viewport * 0.1);
    if (from >= scrollLeft + margin && to <= scrollLeft + viewport - margin) return null;
    const target = to - from <= viewport - margin * 2 ? (from + to) / 2 - viewport / 2 : from - margin;
    const clamped = Math.max(0, Math.min(Math.max(0, contentWidth - viewport), target));
    return Math.abs(clamped - scrollLeft) < 1 ? null : clamped;
};
