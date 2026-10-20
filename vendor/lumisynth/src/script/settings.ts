// src/script/settings.ts
// 剧本的 sidecar：「设置」——剧本只管场景编排，其余工程设置（名称与歌曲信息、画幅、主题、字体、
// 风格库偏好、编排参数、内核与各风格包的 tuning）写成一份 JSON，可以直接改、Ctrl+S 应用（一步撤销）。
// 规则与剧本相同：写了的部分整体换成写的样子（缺的字段取默认值），没写的部分不动。
// 合并方式（agent 的 apply_settings 默认用它）：写的 JSON 逐层并进当前设置，只改写到的字段；
// 数组与其他值整个替换。
// 字段的类型按默认值推断（包的 tuning 由包的 defaults 给出），不认识的键、类型不对是错误，
// 超出范围被夹住的值给提示。诊断的编号是 LS5xx，位置标回 JSON 里的键或值。
import { DEFAULT_ENGINE_PARAMS, DEFAULT_STRUCTURE_PARAMS, normalizeEngineParams, type EngineParams } from '@/compiler/params';
import type { Theme } from '@/core/types';
import { DEFAULT_KERNEL_TUNING, type KernelTuning } from '@/kernel/tuning';
import { allStyles, findPack, listPacks } from '@/packs/registry';
import { DEFAULT_TYPOGRAPHY, normalizeTypography, type ProjectTypography } from '@/project/typography';
import { OUTPUT_LOGICAL_SIZES, type LumiProject, type OutputAspect } from '@/project/types';
import { error, hasErrors, suggest, warning, type Diagnostic, type Span } from './diagnostics';
import { JsonSyntaxError, parseJsonLocated, pathKey, type JsonLocated, type JsonPath } from './json';

export interface ProjectSettings {
    name: string;
    meta: LumiProject['meta'];
    aspect: OutputAspect;
    theme: { variant: 'dark' | 'light'; source: LumiProject['theme']['source']; dark: Theme; light: Theme };
    typography: Omit<ProjectTypography, 'fonts'>;
    library: LumiProject['library'];
    engineParams: EngineParams;
    tuning: { kernel: KernelTuning; packs: Record<string, unknown> };
}

const SECTION_LABELS: Record<keyof ProjectSettings, string> = {
    name: '工程名称', meta: '歌曲信息', aspect: '画幅', theme: '主题', typography: '字体', library: '风格库偏好', engineParams: '编排参数', tuning: 'tuning',
};

const normalizeKernel = (raw: Partial<KernelTuning> | undefined): KernelTuning => ({
    ...DEFAULT_KERNEL_TUNING,
    ...raw,
    background: { ...DEFAULT_KERNEL_TUNING.background, ...raw?.background },
    postProcess: { ...DEFAULT_KERNEL_TUNING.postProcess, ...raw?.postProcess },
    subtitles: { ...DEFAULT_KERNEL_TUNING.subtitles, ...raw?.subtitles },
    motion: { ...DEFAULT_KERNEL_TUNING.motion, ...raw?.motion },
});

const normalizeParams = (raw: unknown): EngineParams => {
    const params = normalizeEngineParams(raw);
    const packs = { ...params.packs };
    listPacks().forEach(pack => { packs[pack.id] = pack.params.normalize(packs[pack.id]); });
    return { ...params, packs };
};

const normalizePacks = (raw: Record<string, unknown> | undefined) => {
    const packs: Record<string, unknown> = { ...raw };
    listPacks().forEach(pack => { packs[pack.id] = pack.tuning.normalize(packs[pack.id]); });
    return packs;
};

/** 工程 → 设置（各部分补齐默认值，写出来就能看到所有可以改的字段）。 */
export const settingsOf = (project: LumiProject): ProjectSettings => ({
    name: project.name,
    meta: project.meta,
    aspect: project.aspect,
    theme: { variant: project.theme.variant, source: project.theme.source, dark: project.theme.dual.dark, light: project.theme.dual.light },
    typography: { lyrics: project.typography.lyrics, subtitles: project.typography.subtitles },
    library: project.library,
    engineParams: normalizeParams(project.engineParams),
    tuning: { kernel: normalizeKernel(project.tuning.kernel), packs: normalizePacks(project.tuning.packs) },
});

export const printSettings = (project: LumiProject) => `${JSON.stringify(settingsOf(project), null, 2)}\n`;

// ---------------------------------------------------------------------------------------------
// 字段的类型

type Schema =
    | { kind: 'number'; min?: number; max?: number }
    | { kind: 'boolean' }
    | { kind: 'string'; options?: readonly string[]; pattern?: RegExp; patternHint?: string }
    | { kind: 'nullable'; of: Schema }
    | { kind: 'array'; of: Schema | null }
    | { kind: 'object'; fields: Record<string, Schema>; required?: string[] }
    | { kind: 'map'; of: (key: string) => Schema | null; keys: () => string[] }
    | { kind: 'any' };

/** 从默认值推断类型：数字、开关、字符串、数组、对象；null 的字段可以是任何值。 */
const inferSchema = (value: unknown): Schema => {
    if (typeof value === 'number') return { kind: 'number' };
    if (typeof value === 'boolean') return { kind: 'boolean' };
    if (typeof value === 'string') return { kind: 'string' };
    if (Array.isArray(value)) return { kind: 'array', of: value.length > 0 ? inferSchema(value[0]) : null };
    if (value && typeof value === 'object') {
        return { kind: 'object', fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, inferSchema(item)])) };
    }
    return { kind: 'any' };
};

/** 主题里可以不写的字段。 */
const THEME_DEFAULTS: Pick<Theme, 'fontStyle' | 'animationIntensity'> = { fontStyle: 'sans', animationIntensity: 'normal' };

const COLOR: Schema = { kind: 'string', pattern: /^#[0-9a-fA-F]{6}$/, patternHint: '颜色写成 #rrggbb' };

const THEME_SCHEMA: Schema = {
    kind: 'object',
    required: ['name', 'backgroundColor', 'primaryColor', 'accentColor', 'secondaryColor'],
    fields: {
        name: { kind: 'string' },
        backgroundColor: COLOR,
        primaryColor: COLOR,
        accentColor: COLOR,
        secondaryColor: COLOR,
        fontStyle: { kind: 'string', options: ['sans', 'serif', 'mono'] },
        fontFamily: { kind: 'string' },
        fontFamilyStack: { kind: 'array', of: { kind: 'string' } },
        fontWeight: { kind: 'number', min: 100, max: 900 },
        animationIntensity: { kind: 'string', options: ['calm', 'normal', 'chaotic'] },
        wordColors: { kind: 'array', of: { kind: 'object', required: ['word', 'color'], fields: { word: { kind: 'string' }, color: COLOR } } },
        lyricsIcons: { kind: 'array', of: { kind: 'string' } },
        provider: { kind: 'string' },
        description: { kind: 'string' },
    },
};

const FONT_FIELDS: Record<string, Schema> = {
    style: { kind: 'string', options: ['sans', 'serif', 'mono'] },
    families: { kind: 'array', of: { kind: 'string' } },
    weight: { kind: 'nullable', of: { kind: 'number', min: 100, max: 900 } },
};

const SETTINGS_SCHEMA = (): Schema => ({
    kind: 'object',
    fields: {
        name: { kind: 'string' },
        meta: { kind: 'object', fields: { title: { kind: 'string' }, artist: { kind: 'string' }, album: { kind: 'string' } } },
        aspect: { kind: 'string', options: Object.keys(OUTPUT_LOGICAL_SIZES) },
        theme: {
            kind: 'object',
            fields: {
                variant: { kind: 'string', options: ['dark', 'light'] },
                source: { kind: 'string', options: ['preset', 'ai', 'custom'] },
                dark: THEME_SCHEMA,
                light: THEME_SCHEMA,
            },
        },
        typography: {
            kind: 'object',
            fields: {
                lyrics: { kind: 'object', fields: { ...FONT_FIELDS, scale: { kind: 'number' } } },
                subtitles: { kind: 'object', fields: { ...FONT_FIELDS, inherit: { kind: 'boolean' } } },
            },
        },
        library: { kind: 'object', fields: { favorites: { kind: 'array', of: { kind: 'string' } }, blocked: { kind: 'array', of: { kind: 'string' } } } },
        engineParams: {
            kind: 'object',
            fields: {
                paragraph: inferSchema(DEFAULT_STRUCTURE_PARAMS),
                packs: { kind: 'map', keys: () => listPacks().map(pack => pack.id), of: id => (findPack(id) ? inferSchema(findPack(id)!.params.defaults) : null) },
            },
        },
        tuning: {
            kind: 'object',
            fields: {
                kernel: inferSchema(DEFAULT_KERNEL_TUNING),
                packs: { kind: 'map', keys: () => listPacks().map(pack => pack.id), of: id => (findPack(id) ? inferSchema(findPack(id)!.tuning.defaults) : null) },
            },
        },
    },
});

const typeName = (schema: Schema): string => {
    switch (schema.kind) {
        case 'number': return '数字';
        case 'boolean': return 'true / false';
        case 'string': return schema.options ? schema.options.map(item => JSON.stringify(item)).join(' / ') : '字符串';
        case 'nullable': return `${typeName(schema.of)} 或 null`;
        case 'array': return '数组 [ … ]';
        case 'object':
        case 'map': return '对象 { … }';
        default: return '任意值';
    }
};

/** partial：合并方式下不查必填字段（没写的取当前值）。 */
const validate = (value: unknown, schema: Schema, path: JsonPath, located: JsonLocated, diagnostics: Diagnostic[], partial = false) => {
    const at = (target: JsonPath = path): Span => located.values.get(pathKey(target)) ?? { line: 1 };
    const keyAt = (target: JsonPath): Span => located.keys.get(pathKey(target)) ?? at(target);
    const name = path.length ? path.join('.') : '设置';
    const wrong = () => diagnostics.push(error('LS503', at(), `${name} 应该是${typeName(schema)}`));
    switch (schema.kind) {
        case 'any': return;
        case 'nullable':
            if (value !== null) validate(value, schema.of, path, located, diagnostics, partial);
            return;
        case 'number':
            if (typeof value !== 'number') return wrong();
            if ((schema.min !== undefined && value < schema.min) || (schema.max !== undefined && value > schema.max)) {
                diagnostics.push(error('LS504', at(), `${name} 应在 ${schema.min} 到 ${schema.max} 之间`));
            }
            return;
        case 'boolean':
            if (typeof value !== 'boolean') wrong();
            return;
        case 'string': {
            if (typeof value !== 'string') return wrong();
            if (schema.options && !schema.options.includes(value)) {
                const close = suggest(value, schema.options);
                diagnostics.push(error('LS504', at(), `${name} 没有 ${JSON.stringify(value)}`, {
                    hint: close.length > 0 ? `是不是想写 ${close.map(item => JSON.stringify(item)).join(' / ')}？` : `可以写 ${typeName(schema)}`,
                }));
            }
            if (schema.pattern && !schema.pattern.test(value)) diagnostics.push(error('LS504', at(), `${name}：${schema.patternHint ?? '格式不对'}`));
            return;
        }
        case 'array':
            if (!Array.isArray(value)) return wrong();
            if (schema.of) value.forEach((item, index) => validate(item, schema.of!, [...path, index], located, diagnostics, partial));
            return;
        case 'object':
        case 'map': {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return wrong();
            const record = value as Record<string, unknown>;
            const known = schema.kind === 'object' ? Object.keys(schema.fields) : schema.keys();
            Object.entries(record).forEach(([key, item]) => {
                const child = schema.kind === 'object' ? schema.fields[key] : schema.of(key);
                if (!child) {
                    const close = suggest(key, known);
                    diagnostics.push(error(schema.kind === 'map' ? 'LS505' : 'LS502', keyAt([...path, key]), schema.kind === 'map' ? `没有风格包 ${key}` : `${name} 里没有 ${key} 这一项`, {
                        hint: close.length > 0 ? `是不是想写 ${close.join(' / ')}？` : `可以写：${known.join(' / ')}`,
                    }));
                    return;
                }
                validate(item, child, [...path, key], located, diagnostics, partial);
            });
            if (schema.kind === 'object' && !partial) {
                schema.required?.filter(key => !(key in record)).forEach(key => diagnostics.push(error('LS503', at(), `${name} 缺少 ${key}`)));
            }
            return;
        }
    }
};

/** 写进来的值被 normalize 改掉了（夹住、补齐）：逐个叶子比较，给出提示。 */
const clampWarnings = (input: unknown, normalized: unknown, path: JsonPath, located: JsonLocated, diagnostics: Diagnostic[]) => {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
        Object.entries(input as Record<string, unknown>).forEach(([key, item]) => {
            if (normalized && typeof normalized === 'object' && key in (normalized as object)) {
                clampWarnings(item, (normalized as Record<string, unknown>)[key], [...path, key], located, diagnostics);
            }
        });
        return;
    }
    if (typeof input === 'number' && typeof normalized === 'number' && Math.abs(input - normalized) > 1e-9) {
        diagnostics.push(warning('LS506', located.values.get(pathKey(path)) ?? { line: 1 }, `${path.join('.')} 超出了范围，按 ${normalized} 处理`));
    }
};

// ---------------------------------------------------------------------------------------------

export interface ApplySettingsResult {
    project: LumiProject;
    changes: string[];
    diagnostics: Diagnostic[];
    ok: boolean;
}

/** 与键的顺序无关的比较。 */
const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined)
            .map(key => [key, canonical((value as Record<string, unknown>)[key])]));
    }
    return value;
};
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** 把 patch 逐层并进 base：对象按键合并，其余（数组、数字、null……）整个替换。 */
export const mergeSettings = (base: unknown, patch: unknown): unknown => {
    if (!isRecord(base) || !isRecord(patch)) return patch;
    const merged: Record<string, unknown> = { ...base };
    Object.entries(patch).forEach(([key, value]) => { merged[key] = key in base ? mergeSettings(base[key], value) : value; });
    return merged;
};

export interface ApplySettingsOptions {
    /** 只改写到的字段（合并进当前设置），而不是把写了的部分整体换掉。 */
    merge?: boolean;
}

export const applySettings = (text: string, project: LumiProject, options: ApplySettingsOptions = {}): ApplySettingsResult => {
    const diagnostics: Diagnostic[] = [];
    const fail = () => ({ project, changes: [], diagnostics, ok: false });
    let located: JsonLocated;
    try {
        located = parseJsonLocated(text);
    } catch (caught) {
        if (!(caught instanceof JsonSyntaxError)) throw caught;
        diagnostics.push(error('LS501', caught.span, `JSON 写法不对：${caught.message}`));
        return fail();
    }
    const merge = options.merge === true;
    validate(located.value, SETTINGS_SCHEMA(), [], located, diagnostics, merge);
    if (hasErrors(diagnostics)) return fail();
    const current = settingsOf(project);
    const written = located.value as Partial<ProjectSettings>;
    // 合并方式：写到的部分并进当前值，之后照整体替换的规则走（没变的部分不算修改）。
    const input = (merge ? mergeSettings(current, written) : written) as Partial<ProjectSettings>;
    const styles = new Set(allStyles().map(style => style.id));
    (['favorites', 'blocked'] as const).forEach(list => written.library?.[list]?.forEach((style, index) => {
        if (styles.has(style)) return;
        const close = suggest(style, [...styles]);
        diagnostics.push(warning('LS507', located.values.get(pathKey(['library', list, index])) ?? { line: 1 }, `没有风格 ${style}（装上对应的包之后才起作用）`, {
            hint: close.length > 0 ? `是不是想写 ${close.join(' / ')}？` : undefined,
        }));
    }));

    const changes: string[] = [];
    let next = project;
    const section = <K extends keyof ProjectSettings>(key: K, wanted: ProjectSettings[K] | undefined, write: (value: ProjectSettings[K]) => LumiProject) => {
        if (wanted === undefined || same(wanted, current[key])) return;
        next = write(wanted);
        changes.push(SECTION_LABELS[key]);
    };
    section('name', input.name, name => ({ ...next, name }));
    section('meta', input.meta && { title: '', artist: '', album: '', ...(input.meta as Partial<ProjectSettings['meta']>) }, meta => ({ ...next, meta }));
    section('aspect', input.aspect, aspect => ({ ...next, aspect }));
    if (input.theme) {
        const theme = {
            variant: input.theme.variant ?? 'dark',
            source: input.theme.source ?? 'custom',
            dark: input.theme.dark ? { ...THEME_DEFAULTS, ...input.theme.dark } : current.theme.dark,
            light: input.theme.light ? { ...THEME_DEFAULTS, ...input.theme.light } : current.theme.light,
        };
        section('theme', theme, value => ({ ...next, theme: { variant: value.variant, source: value.source, dual: { dark: value.dark, light: value.light } } }));
    }
    if (input.typography) {
        const normalized = normalizeTypography({ ...DEFAULT_TYPOGRAPHY, ...input.typography, fonts: project.typography.fonts } as ProjectTypography);
        clampWarnings(input.typography, normalized, ['typography'], located, diagnostics);
        section('typography', { lyrics: normalized.lyrics, subtitles: normalized.subtitles }, value => ({ ...next, typography: { ...value, fonts: project.typography.fonts } }));
    }
    section('library', input.library && { favorites: [], blocked: [], ...(input.library as Partial<ProjectSettings['library']>) }, library => ({ ...next, library }));
    if (input.engineParams) {
        const normalized = normalizeParams({ ...DEFAULT_ENGINE_PARAMS, ...input.engineParams });
        clampWarnings(input.engineParams, normalized, ['engineParams'], located, diagnostics);
        section('engineParams', normalized, engineParams => ({ ...next, engineParams }));
    }
    if (input.tuning) {
        const tuning = {
            kernel: input.tuning.kernel ? normalizeKernel(input.tuning.kernel) : current.tuning.kernel,
            packs: input.tuning.packs ? normalizePacks({ ...project.tuning.packs, ...input.tuning.packs }) : current.tuning.packs,
        };
        clampWarnings(input.tuning, tuning, ['tuning'], located, diagnostics);
        section('tuning', tuning, value => ({ ...next, tuning: value }));
    }
    return { project: next, changes, diagnostics, ok: true };
};
