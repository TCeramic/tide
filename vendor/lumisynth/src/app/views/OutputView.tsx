import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutput } from '../output';

export function OutputView() {
    const entries = useOutput(state => state.entries);
    const bottom = useRef<HTMLDivElement>(null);
    const { t } = useTranslation('workbench');
    useEffect(() => {
        void bottom.current?.scrollIntoView({ block: 'end' });
    }, [entries.length]);
    return (
        <div data-selectable className="px-3 py-1 font-mono text-[12px] leading-5">
            {entries.length === 0 && <div className="text-zinc-600">{t('output.empty')}</div>}
            {entries.map(entry => (
                <div
                    key={entry.id}
                    className={entry.level === 'error' ? 'text-red-300' : entry.level === 'warn' ? 'text-amber-200' : 'text-zinc-300'}
                >
                    <span className="text-zinc-600">[{new Date(entry.time).toLocaleTimeString()}]</span> {entry.message}
                </div>
            ))}
            <div ref={bottom} />
        </div>
    );
}
