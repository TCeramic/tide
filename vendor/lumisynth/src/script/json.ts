// src/script/json.ts
// 带位置的 JSON 解析：值照 JSON.parse 的结果，另外记下每个值（按路径）与每个键在文本里的位置，
// 设置文件（settings.ts）的检查要把错误标回具体的行列。语法错误给出行列与一句话说明。
import type { Span } from './diagnostics';

export type JsonPath = Array<string | number>;

export interface JsonLocated {
    value: unknown;
    /** 路径（JSON.stringify(path)）→ 值的位置。 */
    values: Map<string, Span>;
    /** 路径（JSON.stringify(path)）→ 键的位置（对象的成员才有）。 */
    keys: Map<string, Span>;
}

export class JsonSyntaxError extends Error {
    constructor(message: string, readonly span: Span) {
        super(message);
    }
}

export const pathKey = (path: JsonPath) => JSON.stringify(path);

export const parseJsonLocated = (text: string): JsonLocated => {
    const values = new Map<string, Span>();
    const keys = new Map<string, Span>();
    const lineStarts = [0];
    for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
    const where = (offset: number) => {
        let lo = 0;
        let hi = lineStarts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (lineStarts[mid] <= offset) lo = mid;
            else hi = mid - 1;
        }
        return { line: lo + 1, column: offset - lineStarts[lo] };
    };
    const span = (from: number, to: number): Span => {
        const start = where(from);
        const end = where(Math.max(from, to));
        return { line: start.line, from: start.column, to: end.line === start.line ? end.column : undefined };
    };
    let i = 0;
    const fail = (message: string, at = i): never => {
        throw new JsonSyntaxError(message, span(at, Math.min(text.length, at + 1)));
    };
    const space = () => {
        while (i < text.length && /\s/.test(text[i])) i += 1;
    };
    const string = (): string => {
        const start = i;
        i += 1;
        while (i < text.length && text[i] !== '"') {
            if (text[i] === '\n') fail('字符串没有结束（缺少 "）', start);
            i += text[i] === '\\' ? 2 : 1;
        }
        if (i >= text.length) fail('字符串没有结束（缺少 "）', start);
        i += 1;
        try {
            return JSON.parse(text.slice(start, i)) as string;
        } catch {
            return fail('字符串里有无效的转义', start);
        }
    };
    const value = (path: JsonPath): unknown => {
        space();
        const start = i;
        const char = text[i];
        let result: unknown;
        if (char === '{') {
            i += 1;
            const object: Record<string, unknown> = {};
            space();
            if (text[i] === '}') i += 1;
            else {
                for (;;) {
                    space();
                    if (text[i] !== '"') fail(text[i] === '}' ? '最后一项后面不能有逗号' : '这里应该是用引号括起来的键');
                    const keyStart = i;
                    const key = string();
                    keys.set(pathKey([...path, key]), span(keyStart, i));
                    space();
                    if (text[i] !== ':') fail('键后面缺少冒号 :');
                    i += 1;
                    object[key] = value([...path, key]);
                    space();
                    if (text[i] === ',') {
                        i += 1;
                        continue;
                    }
                    if (text[i] === '}') {
                        i += 1;
                        break;
                    }
                    fail('这里缺少逗号 , 或者 }');
                }
            }
            result = object;
        } else if (char === '[') {
            i += 1;
            const array: unknown[] = [];
            space();
            if (text[i] === ']') i += 1;
            else {
                for (;;) {
                    array.push(value([...path, array.length]));
                    space();
                    if (text[i] === ',') {
                        i += 1;
                        space();
                        if (text[i] === ']') fail('最后一项后面不能有逗号');
                        continue;
                    }
                    if (text[i] === ']') {
                        i += 1;
                        break;
                    }
                    fail('这里缺少逗号 , 或者 ]');
                }
            }
            result = array;
        } else if (char === '"') {
            result = string();
        } else {
            const match = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
            if (!match) fail(i >= text.length ? '内容不完整（缺少结尾）' : `看不懂的值（字符串要用双引号）`);
            i += match![0].length;
            result = JSON.parse(match![0]);
        }
        values.set(pathKey(path), span(start, i));
        return result;
    };
    const result = value([]);
    space();
    if (i < text.length) fail('JSON 结束后还有多余的内容');
    return { value: result, values, keys };
};
