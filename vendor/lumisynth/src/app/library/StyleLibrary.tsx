// src/app/library/StyleLibrary.tsx
// 主侧栏「风格库」：两个包的全部 shot 风格，按族筛选，缩略图按需生成。
// 收藏的风格更常被自动选中，屏蔽的不再被自动选中；选中时间轴上的 shot 后点卡片即锁定为该风格。
import { useState } from 'react';
import { Ban, Heart } from 'lucide-react';
import type { StyleDef } from '@/packs/contract';
import { findPack, listPacks } from '@/packs/registry';
import type { PackId } from '@/compiler/types';
import { lockShotStyle, toggleBlocked, toggleFavorite } from '@/project/edits';
import { setPeek, useSession } from '@/project/session';
import { peekStyle } from '../inspector/StylePickerGrid';
import { useProjectStore } from '@/project/store';
import { useProgram } from '../DerivedProvider';
import { cx, Segmented } from '../ui';
import { StyleThumb, useThumbnailLook } from './StyleThumb';
import type { ThumbnailLook } from './thumbnails';
import { useTranslation } from 'react-i18next';
import { packLabel } from '@/i18n/catalog';

function StyleCard({ style, look, favorite, blocked, onPick, onPeek, pickable }: {
    style: StyleDef;
    look: ThumbnailLook;
    favorite: boolean;
    blocked: boolean;
    onPick: () => void;
    onPeek: () => void;
    pickable: boolean;
}) {
    const { t } = useTranslation('inspector');
    return (
        <div className={cx('group relative overflow-hidden rounded-md border bg-zinc-900', blocked ? 'border-red-900/70 opacity-50' : 'border-zinc-800')}>
            <button type="button" onClick={onPick} onMouseEnter={() => { if (pickable) onPeek(); }} disabled={!pickable} className="block w-full disabled:cursor-default" title={pickable ? t('library.pickHint') : style.kind}>
                <StyleThumb style={style.id} look={look} />
                <div className="flex items-center justify-between px-1.5 py-1 text-[11px]">
                    <span className="truncate text-zinc-200">{style.kind}</span>
                    <span className="shrink-0 text-zinc-500">{style.mood}</span>
                </div>
            </button>
            <div className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100" style={favorite || blocked ? { opacity: 1 } : undefined}>
                <button type="button" onClick={() => toggleFavorite(style.id)} className={cx('rounded bg-zinc-950/80 p-1', favorite ? 'text-amber-300' : 'text-zinc-400 hover:text-zinc-100')} aria-label={t('style.favorite')}>
                    <Heart size={12} fill={favorite ? 'currentColor' : 'none'} />
                </button>
                <button type="button" onClick={() => toggleBlocked(style.id)} className={cx('rounded bg-zinc-950/80 p-1', blocked ? 'text-red-400' : 'text-zinc-400 hover:text-zinc-100')} aria-label={t('style.block')}>
                    <Ban size={12} />
                </button>
            </div>
        </div>
    );
}

export function StyleLibrary({ wide = false }: { wide?: boolean }) {
    const project = useProjectStore(state => state.project);
    const selection = useSession(state => state.selection);
    const program = useProgram();
    const [pack, setPack] = useState<PackId>(() => listPacks()[0]?.id ?? '');
    const [family, setFamily] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'favorites' | 'blocked'>('all');
    const { t } = useTranslation('inspector');

    const look = useThumbnailLook();
    const favorites = new Set(project.library.favorites);
    const blocked = new Set(project.library.blocked);
    const selectedShot = selection.type === 'shot'
        ? program.paragraphs.find(p => p.id === selection.paragraphId)?.shots.find(s => s.id === selection.shotId) ?? null
        : null;

    const styles = (findPack(pack)?.styles ?? [])
        .filter(style => !family || style.family === family)
        .filter(style => filter === 'all' || (filter === 'favorites' ? favorites.has(style.id) : blocked.has(style.id)));

    return (
        <div className="space-y-2 px-3 py-2">
            <Segmented<PackId>
                value={pack}
                onChange={value => {
                    setPack(value);
                    setFamily(null);
                }}
                options={listPacks().map(item => ({ value: item.id, label: packLabel(item.id) }))}
            />
            <div className="flex flex-wrap gap-1">
                <button type="button" onClick={() => setFamily(null)} className={cx('rounded border px-1.5 py-0.5 text-[11px]', family === null ? 'border-amber-400 text-amber-100' : 'border-zinc-700 text-zinc-400')}>{t('library.all')}</button>
                {(findPack(pack)?.families ?? []).map(item => (
                    <button key={item.id} type="button" onClick={() => setFamily(item.id)} className={cx('rounded border px-1.5 py-0.5 text-[11px]', family === item.id ? 'border-amber-400 text-amber-100' : 'border-zinc-700 text-zinc-400')}>
                        {item.label}
                    </button>
                ))}
            </div>
            <Segmented<'all' | 'favorites' | 'blocked'>
                value={filter}
                onChange={setFilter}
                options={[{ value: 'all', label: t('library.all') }, { value: 'favorites', label: t('library.favorites', { count: project.library.favorites.length }) }, { value: 'blocked', label: t('library.blocked', { count: project.library.blocked.length }) }]}
            />
            <div className="text-[11px] text-zinc-500">
                {selectedShot
                    ? selectedShot.pack === pack || project.direction.shotMixing
                        ? t('library.pickShot')
                        : t('library.otherPack')
                    : t('library.hint')}
            </div>
            <div className={cx('grid gap-2', wide ? 'grid-cols-[repeat(auto-fill,minmax(180px,1fr))]' : 'grid-cols-2')} onMouseLeave={() => setPeek(null)}>
                {styles.map(style => (
                    <StyleCard
                        key={style.id}
                        style={style}
                        look={look}
                        favorite={favorites.has(style.id)}
                        blocked={blocked.has(style.id)}
                        pickable={Boolean(selectedShot && (selectedShot.pack === style.pack || project.direction.shotMixing))}
                        onPick={() => {
                            setPeek(null, 0);
                            if (selectedShot) lockShotStyle(selectedShot, style.id);
                        }}
                        onPeek={() => selectedShot && peekStyle(selectedShot, style.id)}
                    />
                ))}
            </div>
        </div>
    );
}
