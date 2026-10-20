// src/app/wizard/themeNames.ts
// 生成的主题名字（随机配色、封面取色）：「名字 · 深色 / 浅色」，跟着界面语言。
import { t } from '@/i18n';

/** 主题名字：「名字 · 深色」。 */
export const themeName = (label: string, mode: 'dark' | 'light') => t('wizard:themeName', { name: label, mode: t(`theme:modes.${mode}`) });

/** 去掉名字末尾的「 · 深色 / 浅色」。 */
export const stripModeSuffix = (name: string) => (['dark', 'light'] as const)
    .map(mode => themeName('', mode))
    .reduce((text, suffix) => (text.endsWith(suffix) ? text.slice(0, -suffix.length) : text), name);

/** 名字里带着深色 / 浅色了。 */
export const hasModeSuffix = (name: string) => stripModeSuffix(name) !== name;
