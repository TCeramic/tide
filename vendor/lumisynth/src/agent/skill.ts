// src/agent/skill.ts
// 写剧本的 agent skill（skills/lumiscript/）：SKILL.md 是给 agent 的工作流程，reference.md 是 LumiScript v2
// 的完整语法。MCP 工具 script_reference 返回这两份；「Agent」面板可以把它们打包下载，
// 解压到 agent 的 skills 目录（Claude Code：~/.claude/skills/）后，没有连上本页面的 agent 也能写剧本，
// 写好的 .lumiscript 在「剧本」标签页导入。
import { strToU8, zipSync } from 'fflate';
import SKILL from '../../skills/lumiscript/SKILL.md?raw';
import REFERENCE from '../../skills/lumiscript/reference.md?raw';

export const SCRIPT_SKILL = SKILL;
export const SCRIPT_REFERENCE = REFERENCE;

export const SKILL_ARCHIVE_NAME = 'lumiscript-skill.zip';

export const skillArchive = () => new Blob([zipSync({
    'lumiscript/SKILL.md': strToU8(SKILL),
    'lumiscript/reference.md': strToU8(REFERENCE),
})], { type: 'application/zip' });
