// src/script/syntax.ts
// LumiScript 的词法：一行一条语句，词之间用空白分开；字符串用 JSON 的写法；
// 「# 」（井号后面跟空格或行尾）开始注释，#1e1b4b 这样紧跟十六进制的是颜色。语法见 docs/SCRIPT.md。

export interface Token {
    text: string;
    /** 字符串词：已按 JSON 解开的值。 */
    string?: string;
    /** 在行内的起止列（0 起）。 */
    from: number;
    to: number;
}

export interface LexedLine {
    tokens: Token[];
    /** 注释开始的列（没有注释为 -1）。 */
    commentAt: number;
    error?: { from: number; to: number; message: string };
}

/** 注释从哪一列开始：不在字符串里、位于行首或空白之后、后面是空白或行尾的「#」。 */
export const findComment = (text: string) => {
    let inString = false;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (inString) {
            if (char === '\\') i += 1;
            else if (char === '"') inString = false;
            continue;
        }
        if (char === '"') inString = true;
        else if (char === '#' && (i === 0 || /\s/.test(text[i - 1])) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) return i;
    }
    return -1;
};

export const lexLine = (text: string): LexedLine => {
    const commentAt = findComment(text);
    const code = commentAt >= 0 ? text.slice(0, commentAt) : text;
    const tokens: Token[] = [];
    let i = 0;
    while (i < code.length) {
        if (/\s/.test(code[i])) {
            i += 1;
            continue;
        }
        const from = i;
        if (code[i] === '"') {
            i += 1;
            while (i < code.length && code[i] !== '"') i += code[i] === '\\' ? 2 : 1;
            if (i >= code.length) return { tokens, commentAt, error: { from, to: code.length, message: '字符串没有结束（缺少 "）' } };
            i += 1;
            const raw = code.slice(from, i);
            try {
                tokens.push({ text: raw, string: JSON.parse(raw) as string, from, to: i });
            } catch {
                return { tokens, commentAt, error: { from, to: i, message: '字符串里有无效的转义' } };
            }
            continue;
        }
        while (i < code.length && !/\s/.test(code[i]) && code[i] !== '"') i += 1;
        tokens.push({ text: code.slice(from, i), from, to: i });
    }
    return { tokens, commentAt };
};

// ---------------------------------------------------------------------------------------------
// 数值

/** m:ss.cc */
export const formatTime = (seconds: number) => {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const rest = safe - minutes * 60;
    const fixed = rest.toFixed(2);
    // 59.996 这样的值四舍五入成 60.00：进位到分钟。
    if (Number(fixed) >= 60) return `${minutes + 1}:00.00`;
    return `${minutes}:${fixed.padStart(5, '0')}`;
};

export const formatRange = (start: number, end: number) => `${formatTime(start)}-${formatTime(end)}`;

export const parseTime = (text: string): number | null => {
    const match = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(text);
    if (match) return Number(match[1]) * 60 + Number(match[2]);
    return /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
};

export const parseRange = (text: string): { start: number; end: number } | null => {
    const match = /^([\d:.]+)-([\d:.]+)$/.exec(text);
    if (!match) return null;
    const start = parseTime(match[1]);
    const end = parseTime(match[2]);
    return start === null || end === null ? null : { start, end };
};

/** 固定两位小数（与解析后的比较容差配套）。 */
export const num = (value: number, digits = 2) => {
    const text = value.toFixed(digits);
    return text === `-${(0).toFixed(digits)}` ? (0).toFixed(digits) : text;
};

export const parseNumber = (text: string): number | null => (/^-?\d+(?:\.\d+)?$/.test(text) ? Number(text) : null);

/** 两位小数写出的值读回来的比较。 */
export const near = (a: number, b: number, tolerance = 0.006) => Math.abs(a - b) <= tolerance;

export const quote = (text: string) => JSON.stringify(text);

/** 片段 id 在剧本里只写前 8 位。 */
export const shortId = (id: string) => id.slice(0, 8);

export const isColor = (text: string) => /^#[0-9a-fA-F]{6}$/.test(text);
