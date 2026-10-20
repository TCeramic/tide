// src/app/DerivedProvider.tsx
// 解析歌词与编译 LumiProgram 在应用顶层各做一次，组件经 context 读取，不各自重算。
import { createContext, useContext, type ReactNode } from 'react';
import type { LumiProgram } from '@/compiler/types';
import { useCompileProgram, useComputeEffectiveLyrics, type EffectiveLyrics } from './derived';

interface Derived {
    lyrics: EffectiveLyrics;
    program: LumiProgram;
}

const DerivedContext = createContext<Derived | null>(null);

export function DerivedProvider({ children }: { children: ReactNode }) {
    const lyrics = useComputeEffectiveLyrics();
    const program = useCompileProgram(lyrics);
    return <DerivedContext.Provider value={{ lyrics, program }}>{children}</DerivedContext.Provider>;
}

const useDerived = () => {
    const value = useContext(DerivedContext);
    if (!value) throw new Error('DerivedProvider is missing');
    return value;
};

export const useEffectiveLyrics = () => useDerived().lyrics;
export const useProgram = () => useDerived().program;
