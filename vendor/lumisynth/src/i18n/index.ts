// src/i18n/index.ts
// 界面文字的多语言（i18next）。字典在 locales/<语言>/<命名空间>.json：中文是原文（键的类型由它推出），
// 其他语言缺的键回退到英文。加一种语言 = 加一个 locales/<语言>/ 目录 + 在 LANGUAGES 与 resources 里各加一行。
// 界面语言是每个浏览器自己的偏好，存 localStorage，不进工程文件；没选过就跟随浏览器。
// React 组件用 useTranslation()；组件以外（命令、日志、右键菜单）用这里导出的 t，
// 并且要在用到的时候再取文字（不要在模块顶层算好存起来），这样切换语言后才会更新。
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import zh from './locales/zh';

export const resources = { zh, en } as const;

export type Language = keyof typeof resources;

/** 可选的界面语言，名字用各自的语言写。 */
export const LANGUAGES: Array<{ code: Language; label: string; htmlLang: string }> = [
    { code: 'zh', label: '简体中文', htmlLang: 'zh-CN' },
    { code: 'en', label: 'English', htmlLang: 'en' },
];

const STORAGE_KEY = 'lumisynth:language';

const isLanguage = (value: unknown): value is Language => typeof value === 'string' && value in resources;

const storedLanguage = (): string | null => {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
};

/** 选过的语言；没选过就按浏览器的语言偏好挑第一个支持的，都不支持用英文。 */
export const detectLanguage = (): Language => {
    const stored = storedLanguage();
    if (isLanguage(stored)) return stored;
    const preferred = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]);
    for (const tag of preferred) {
        const base = tag?.toLowerCase().split('-')[0];
        if (isLanguage(base)) return base;
    }
    return 'en';
};

const syncDocument = (language: string) => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = LANGUAGES.find(item => item.code === language)?.htmlLang ?? language;
};

void i18next.use(initReactI18next).init({
    resources,
    lng: detectLanguage(),
    fallbackLng: 'en',
    supportedLngs: LANGUAGES.map(item => item.code),
    nonExplicitSupportedLngs: true,
    ns: Object.keys(zh),
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
});
syncDocument(i18next.language);
i18next.on('languageChanged', syncDocument);

export const currentLanguage = (): Language => (isLanguage(i18next.resolvedLanguage) ? i18next.resolvedLanguage : 'en');

/** 切换界面语言并记住。 */
export const setLanguage = (language: Language) => {
    try {
        localStorage.setItem(STORAGE_KEY, language);
    } catch {
        // 隐私模式等拿不到存储：这次会话里照样切换。
    }
    void i18next.changeLanguage(language);
};

export const t = i18next.t.bind(i18next);
export { i18next };
