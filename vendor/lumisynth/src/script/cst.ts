// src/script/cst.ts
// 剧本的第一层结构：一行一条语句（开头的词 + 参数），行尾是 { 的语句带一个块，块以单独一行的 } 结束。
// 这一层只管词法与括号配对，不认识任何关键字；语句的含义由 parse.ts 解读。
// 出错的行跳过，不影响其余的行，所以一次能报出所有的语法错误。
import { error, type Diagnostic } from './diagnostics';
import { lexLine, type Token } from './syntax';

export interface Statement {
    /** 行号（1 起）。 */
    line: number;
    head: Token;
    args: Token[];
    /** 带块的语句：块里的语句；不带块时为 null。 */
    block: Statement[] | null;
    /** 块结束（}）的行号；没有结束时为 null。 */
    endLine: number | null;
}

export interface Cst {
    statements: Statement[];
    diagnostics: Diagnostic[];
    /** 每一行的词（行号 1 起，下标 0 不用），给补全、悬停用。 */
    lines: Token[][];
}

export const parseCst = (text: string): Cst => {
    const diagnostics: Diagnostic[] = [];
    const root: Statement[] = [];
    const stack: Array<{ owner: Statement | null; body: Statement[] }> = [{ owner: null, body: root }];
    const rows = text.split(/\r?\n/);
    const lines: Token[][] = [[]];

    rows.forEach((row, index) => {
        const lineNumber = index + 1;
        const lexed = lexLine(row);
        lines.push(lexed.tokens);
        if (lexed.error) {
            diagnostics.push(error('LS101', { line: lineNumber, ...lexed.error }, lexed.error.message, { hint: '字符串用 JSON 的写法："文字"，里面的 " 写成 \\"' }));
            return;
        }
        const tokens = lexed.tokens;
        if (tokens.length === 0) return;
        const top = stack.at(-1)!;

        if (tokens[0].text === '}') {
            if (tokens.length > 1) diagnostics.push(error('LS103', { line: lineNumber, from: tokens[1].from, to: tokens.at(-1)!.to }, '} 要单独占一行'));
            if (!top.owner) {
                diagnostics.push(error('LS104', { line: lineNumber, from: tokens[0].from, to: tokens[0].to }, '多余的 }，前面没有对应的 {'));
                return;
            }
            top.owner.endLine = lineNumber;
            stack.pop();
            return;
        }
        const opens = tokens.at(-1)!.text === '{';
        const body = opens ? tokens.slice(0, -1) : tokens;
        const stray = body.find(token => token.text === '{' || token.text === '}');
        if (stray) {
            diagnostics.push(error('LS102', { line: lineNumber, from: stray.from, to: stray.to }, stray.text === '{' ? '{ 只能写在行尾' : '} 要单独占一行'));
        }
        if (body.length === 0) {
            diagnostics.push(error('LS105', { line: lineNumber, from: tokens[0].from, to: tokens[0].to }, '{ 前面缺少语句（例如 paragraph {）'));
            // 块照样配对（块里的语句丢掉），免得后面的 } 被当成多余的。
            if (opens) stack.push({ owner: { line: lineNumber, head: tokens[0], args: [], block: [], endLine: null }, body: [] });
            return;
        }
        const statement: Statement = {
            line: lineNumber,
            head: body[0],
            args: stray ? body.slice(1).filter(token => token !== stray) : body.slice(1),
            block: opens ? [] : null,
            endLine: null,
        };
        top.body.push(statement);
        if (opens) stack.push({ owner: statement, body: statement.block! });
    });

    for (let i = stack.length - 1; i >= 1; i -= 1) {
        const owner = stack[i].owner;
        if (owner) {
            diagnostics.push(error('LS106', { line: owner.line, from: owner.head.from, to: owner.head.to }, `这个 ${owner.head.text} 块没有用 } 结束`, {
                hint: '在块的最后一行后面加一行 }',
            }));
        }
    }
    return { statements: root, diagnostics, lines };
};
