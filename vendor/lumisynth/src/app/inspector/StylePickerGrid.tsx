// src/app/inspector/StylePickerGrid.tsx
// 检查器「换成…」：带缩略图的风格网格。鼠标停留或方向键移动时预览区临时套用（peek），
// 点击或回车才写进工程；离开网格或按 Esc 恢复。
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { LumiShot } from '@/compiler/types';
import type { StyleDef } from '@/packs/contract';
import { lockShotStyle } from '@/project/edits';
import { setPeek } from '@/project/session';
import { StyleThumb, useThumbnailLook } from '../library/StyleThumb';
import { clock, seek } from '../playback';
import { cx } from '../ui';

const COLUMNS = 2;

/** 试看时让预览停在这个镜头上（暂停中且播放头不在镜头里时，跳到镜头中段）。 */
export const bringShotIntoView = (shot: LumiShot) => {
    if (!clock.paused) return;
    const time = clock.get();
    if (time >= shot.startTime && time < shot.endTime) return;
    seek(shot.startTime + (shot.endTime - shot.startTime) * 0.6);
};

export const peekStyle = (shot: LumiShot, style: string) => {
    bringShotIntoView(shot);
    setPeek([{ id: 'peek-style', type: 'shot-style', anchor: shot.anchor, style }]);
};

export function StylePickerGrid({ shot, styles }: { shot: LumiShot; styles: StyleDef[] }) {
    const look = useThumbnailLook();
    const { t } = useTranslation('inspector');
    const [active, setActive] = useState(-1);
    const container = useRef<HTMLDivElement>(null);

    // 换了镜头或离开检查器：结束试看。
    useEffect(() => () => setPeek(null), [shot.id]);

    const commit = (style: StyleDef) => {
        setPeek(null, 0);
        if (style.id !== shot.style || !shot.locked) lockShotStyle(shot, style.id);
    };

    const focusIndex = (index: number) => {
        const next = Math.max(0, Math.min(styles.length - 1, index));
        setActive(next);
        peekStyle(shot, styles[next].id);
        container.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.scrollIntoView({ block: 'nearest' });
    };

    const onKeyDown = (event: KeyboardEvent) => {
        const current = active < 0 ? styles.findIndex(style => style.id === shot.style) : active;
        const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS };
        if (event.key in moves) {
            event.preventDefault();
            focusIndex(current < 0 ? 0 : current + moves[event.key]);
        } else if (event.key === 'Enter' && active >= 0) {
            event.preventDefault();
            commit(styles[active]);
        } else if (event.key === 'Escape') {
            setActive(-1);
            setPeek(null, 0);
        }
    };

    return (
        <div
            ref={container}
            role="listbox"
            aria-label={t('picker.label')}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onMouseLeave={() => {
                setActive(-1);
                setPeek(null);
            }}
            onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPeek(null);
            }}
            className="grid grid-cols-2 gap-1.5 rounded outline-none focus-visible:ring-1 focus-visible:ring-amber-400/60"
        >
            {styles.map((style, index) => {
                const current = style.id === shot.style;
                return (
                    <button
                        key={style.id}
                        type="button"
                        role="option"
                        aria-selected={current}
                        tabIndex={-1}
                        onMouseEnter={() => {
                            setActive(index);
                            peekStyle(shot, style.id);
                        }}
                        onClick={() => commit(style)}
                        title={t('picker.hover', { kind: style.kind, mood: style.mood })}
                        className={cx(
                            'overflow-hidden rounded border text-left',
                            current ? 'border-amber-400' : index === active ? 'border-zinc-400' : 'border-zinc-800 hover:border-zinc-600',
                        )}
                    >
                        <StyleThumb style={style.id} look={look} />
                        <div className={cx('truncate px-1 py-0.5 text-[10px]', current ? 'bg-amber-400/15 text-amber-100' : 'text-zinc-300')}>{style.kind}</div>
                    </button>
                );
            })}
        </div>
    );
}
