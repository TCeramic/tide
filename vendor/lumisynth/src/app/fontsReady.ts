// src/app/fontsReady.ts
// 字体设置变了先把字体加载好，再交给渲染：各包排版时按字体量字宽（并缓存），
// 用回退字体量出来的宽度会让新字体挤在一起或散开。加载超时（3 秒）也照样往下走。
import { useEffect, useState } from 'react';
import { registerProjectFonts } from '@/project/fonts';
import { useProjectStore } from '@/project/store';
import { cssFontOf, subtitleFontOf, type ProjectTypography } from '@/project/typography';

const SAMPLE = '国あAa';

export const loadTypographyFonts = async (typography: ProjectTypography) => {
    if (typeof document === 'undefined' || !document.fonts) return;
    const work = (async () => {
        await registerProjectFonts(typography.fonts);
        await Promise.all([typography.lyrics, subtitleFontOf(typography)].flatMap(font => [
            document.fonts.load(cssFontOf(font), SAMPLE),
            document.fonts.load(cssFontOf({ ...font, weight: 700 }), SAMPLE),
        ])).catch(() => undefined);
    })();
    await Promise.race([work, new Promise(resolve => setTimeout(resolve, 3000))]);
};

/** 字体已经加载好的字体设置（新设置加载完成之前沿用上一份）。 */
export const useReadyTypography = (): ProjectTypography => {
    const typography = useProjectStore(state => state.project.typography);
    const [ready, setReady] = useState(typography);
    useEffect(() => {
        let cancelled = false;
        void loadTypographyFonts(typography).then(() => {
            // 总是换一个新对象：即使设置没变（首次加载、上传的字体刚注册），也让渲染重建一次。
            if (!cancelled) setReady({ ...typography });
        });
        return () => { cancelled = true; };
    }, [typography]);
    return ready;
};
