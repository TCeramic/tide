// src/script/diagnostics.ts
// 剧本的诊断：每一条都带编号、位置（行 / 列）、一句话说明，可以附一条提示、相关位置与快速修复。
// 编号按阶段分：1xx 词法与语法，2xx 名称（包 / 风格 / 素材……不存在），3xx 结构（行覆盖、重复、挂载点），
// 4xx 编译（写了但编排里做不到），9xx 提示。编辑器、「问题」面板、agent 都用同一份。

export type Severity = 'error' | 'warning' | 'info';

/** 位置：行号 1 起，列 0 起；没有列时标整行。 */
export interface Span {
    line: number;
    from?: number;
    to?: number;
}

/** 快速修复：把若干处文字换掉（位置同 Span，列必填）。 */
export interface Fix {
    label: string;
    edits: Array<{ line: number; from: number; to: number; insert: string }>;
}

export interface Diagnostic extends Span {
    code: string;
    severity: Severity;
    message: string;
    /** 怎么改（给人和 agent 看的一句话）。 */
    hint?: string;
    related?: Array<Span & { message: string }>;
    fixes?: Fix[];
}

export const hasErrors = (diagnostics: Diagnostic[]) => diagnostics.some(item => item.severity === 'error');

export const diag = (
    severity: Severity,
    code: string,
    at: Span,
    message: string,
    extra: Pick<Diagnostic, 'hint' | 'related' | 'fixes'> = {},
): Diagnostic => ({ line: at.line, from: at.from, to: at.to, severity, code, message, ...extra });

export const error = (code: string, at: Span, message: string, extra?: Pick<Diagnostic, 'hint' | 'related' | 'fixes'>) => diag('error', code, at, message, extra);
export const warning = (code: string, at: Span, message: string, extra?: Pick<Diagnostic, 'hint' | 'related' | 'fixes'>) => diag('warning', code, at, message, extra);

/** 把 at 这个词换成 insert 的修复。 */
export const replaceFix = (label: string, at: Span, insert: string): Fix | null => (
    at.from === undefined || at.to === undefined ? null : { label, edits: [{ line: at.line, from: at.from, to: at.to, insert }] }
);

// ---------------------------------------------------------------------------------------------
// 拼写建议

const distance = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const current = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
            previous = current;
        }
    }
    return row[b.length];
};

/**
 * 候选里最像的几个：编辑距离足够小，或者一个包含另一个（`duo-split` → `tempera/duo-split`）。
 * 返回按相似程度排好的列表。
 */
export const suggest = (word: string, candidates: readonly string[], limit = 3): string[] => {
    const lower = word.toLowerCase();
    const scored = candidates
        .map(candidate => {
            const other = candidate.toLowerCase();
            const contains = other.includes(lower) || lower.includes(other);
            const tail = other.split('/').pop()!;
            const score = Math.min(distance(lower, other), distance(lower, tail) + 0.5) - (contains ? 1 : 0);
            return { candidate, score };
        })
        .filter(item => item.score <= Math.max(1, Math.floor(word.length / 3)))
        .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate));
    return [...new Set(scored.map(item => item.candidate))].slice(0, limit);
};

/** 「没有 X」的诊断：附上最像的候选与对应的快速修复。 */
export const unknownName = (code: string, at: Span, message: string, word: string, candidates: readonly string[], listHint?: string): Diagnostic => {
    const close = suggest(word, candidates);
    const fixes = close.map(item => replaceFix(`改成 ${item}`, at, item)).filter((item): item is Fix => item !== null);
    const hint = close.length > 0
        ? `是不是想写 ${close.join(' / ')}？`
        : listHint ?? (candidates.length > 0 && candidates.length <= 12 ? `可以写：${candidates.join(' / ')}` : undefined);
    return error(code, at, message, { hint, fixes });
};

/** 一条诊断写成一行文字（agent 与「输出」用）。 */
export const formatDiagnostic = (item: Diagnostic) => {
    const where = item.from === undefined ? `第 ${item.line} 行` : `第 ${item.line} 行第 ${item.from + 1} 列`;
    const label = item.severity === 'error' ? '错误' : item.severity === 'warning' ? '提示' : '说明';
    const parts = [`${where} ${label} ${item.code}：${item.message}`];
    if (item.hint) parts.push(`  → ${item.hint}`);
    item.related?.forEach(related => parts.push(`  · 第 ${related.line} 行：${related.message}`));
    return parts.join('\n');
};
