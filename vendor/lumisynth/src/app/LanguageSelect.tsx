// src/app/LanguageSelect.tsx
// 界面语言的下拉框（「设置」编辑器顶部、手机布局的设置里）。语言名用各自的语言写。
import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { currentLanguage, LANGUAGES, setLanguage, type Language } from '@/i18n';
import { cx } from './ui';

export function LanguageSelect({ className }: { className?: string }) {
    const { t, i18n } = useTranslation('workbench');
    // i18n.language 让切换后重渲染；显示的值按实际生效的语言。
    const value = i18n.language ? currentLanguage() : 'en';
    return (
        <label className={cx('flex shrink-0 items-center gap-1.5 text-xs text-zinc-400', className)}>
            <Languages size={14} className="text-zinc-500" />
            <span className="sr-only">{t('language.label')}</span>
            <select
                aria-label={t('language.label')}
                value={value}
                onChange={event => setLanguage(event.target.value as Language)}
                className="h-7 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 text-xs text-zinc-200 outline-none focus:border-amber-400/70"
            >
                {LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.label}</option>)}
            </select>
        </label>
    );
}
