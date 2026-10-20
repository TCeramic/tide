// src/i18n/catalog.ts
// 风格包目录里给人看的名字。包自己写的是中文原文；翻译放在 packs 命名空间里按包 id 查，查不到就用原文
// （第三方包、还没翻译的语言都会落到原文）。
import type { PackId, ParagraphKind } from '@/compiler/types';
import { findPack } from '@/packs/registry';
import { i18next } from './index';

const lookup = (id: PackId, field: 'label' | 'shortLabel' | 'description', fallback: string) => {
    const key = `packs:${id}.${field}`;
    return i18next.exists(key) ? i18next.t(key as never) as string : fallback;
};

/** 段落性质（主歌、副歌……）。 */
export const paragraphKindLabel = (kind: ParagraphKind) => i18next.t(`common:paragraphKinds.${kind}`);

export const packLabel = (id: PackId) => lookup(id, 'label', findPack(id)?.label ?? id);
export const packShortLabel = (id: PackId) => lookup(id, 'shortLabel', findPack(id)?.shortLabel ?? id);
export const packDescription = (id: PackId) => lookup(id, 'description', findPack(id)?.description ?? '');
