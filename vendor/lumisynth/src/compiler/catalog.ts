// src/compiler/catalog.ts
// 风格与转场目录都由各个风格包提供，这里只是注册表的便捷出口。
export {
    allFamilies,
    allStyles,
    allTransitions,
    familyLabel,
    getStyle,
    getTransition,
    listPacks,
    findPack,
    getPack,
} from '@/packs/registry';
export type { FamilyDef, Mood, StyleDef, TransitionDef } from '@/packs/contract';
