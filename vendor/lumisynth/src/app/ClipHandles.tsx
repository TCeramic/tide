// src/app/ClipHandles.tsx
// 预览上选中素材片段的编辑框：拖动框内移动，拖右下角缩放（以中心为基准），拖顶部的圆点旋转。
// 只在播放头落在片段时间里时显示。拖动时的修改合并成一步撤销。
// 跟随运镜的片段：框画在套过这一帧运镜的位置；拖动按这一帧的运镜反算，写回的是没有运镜时的值，
// 所以在哪一帧拖结果都一样。
import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { getPreviewKernel } from '@/agent/host';
import { resolveAssetClips } from '@/core/assets/clips';
import { apply, decompose, IDENTITY } from '@/kernel/cameraFollow';
import { updateAssetClip } from '@/project/assets';
import { useSession } from '@/project/session';
import { useProjectStore } from '@/project/store';
import { useProgram } from './DerivedProvider';
import { usePlayback } from './playback';
import { useTranslation } from 'react-i18next';

export function ClipHandles({ width, height, scale }: { width: number; height: number; scale: number }) {
    const { t } = useTranslation('media');
    const selection = useSession(state => state.selection);
    const clips = useProjectStore(state => state.project.assetClips);
    const assets = useProjectStore(state => state.project.assets);
    const program = useProgram();
    const clipId = selection.type === 'clip' ? selection.clipId : null;
    const resolved = useMemo(() => {
        const clip = clips.find(item => item.id === clipId);
        return clip ? resolveAssetClips([clip], program, new Set(assets.map(item => item.id))).resolved[0] ?? null : null;
    }, [clips, clipId, program, assets]);
    const visible = usePlayback(state => Boolean(resolved && state.time >= resolved.start && state.time < resolved.end));
    const following = Boolean(resolved && resolved.follow && resolved.follow !== 'off');
    // 只有跟随运镜时框才需要逐帧跟着动。
    const time = usePlayback(state => (following ? state.time : 0));
    const box = useRef<HTMLDivElement>(null);
    if (!resolved || !visible) return null;

    const follow = following ? getPreviewKernel()?.clipFollowAt(resolved, time) ?? IDENTITY : IDENTITY;
    const followParts = decompose(follow, 0, 0);
    const asset = assets.find(item => item.id === resolved.assetId);
    const aspect = asset && asset.height > 0 ? asset.width / asset.height : 1;
    const boxHeight = resolved.scale * height * scale * followParts.scale;
    const boxWidth = boxHeight * aspect;
    const center = apply(follow, resolved.x * width, resolved.y * height);
    const centerX = center.x * scale;
    const centerY = center.y * scale;
    const rotation = resolved.rotation + followParts.rotation;

    const drag = (event: ReactPointerEvent, mode: 'move' | 'scale' | 'rotate') => {
        event.stopPropagation();
        event.preventDefault();
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture(event.pointerId);
        const origin = { x: event.clientX, y: event.clientY };
        const rect = box.current?.getBoundingClientRect();
        const pivot = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : origin;
        const startDistance = Math.max(4, Math.hypot(origin.x - pivot.x, origin.y - pivot.y));
        const start = { x: resolved.x, y: resolved.y, scale: resolved.scale, rotation: resolved.rotation };
        // 屏幕上的位移换回没有运镜时的位移：去掉运镜的旋转与缩放。
        const cos = Math.cos(-followParts.rotation) / followParts.scale;
        const sin = Math.sin(-followParts.rotation) / followParts.scale;
        const move = (moveEvent: PointerEvent) => {
            if (mode === 'move') {
                const dx = (moveEvent.clientX - origin.x) / scale;
                const dy = (moveEvent.clientY - origin.y) / scale;
                updateAssetClip(resolved.id, {
                    x: start.x + (cos * dx - sin * dy) / width,
                    y: start.y + (sin * dx + cos * dy) / height,
                }, 'canvas-move');
            } else if (mode === 'scale') {
                const distance = Math.hypot(moveEvent.clientX - pivot.x, moveEvent.clientY - pivot.y);
                updateAssetClip(resolved.id, { scale: Math.max(0.02, start.scale * (distance / startDistance)) }, 'canvas-scale');
            } else {
                const angle = Math.atan2(moveEvent.clientY - pivot.y, moveEvent.clientX - pivot.x) + Math.PI / 2 - followParts.rotation;
                const snapped = moveEvent.shiftKey ? Math.round(angle / (Math.PI / 12)) * (Math.PI / 12) : angle;
                updateAssetClip(resolved.id, { rotation: Math.atan2(Math.sin(snapped), Math.cos(snapped)) }, 'canvas-rotate');
            }
        };
        const up = () => {
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', up);
            target.removeEventListener('pointercancel', up);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
    };

    return (
        <div
            ref={box}
            data-testid="clip-handles"
            onPointerDown={event => drag(event, 'move')}
            className="absolute cursor-move border border-emerald-300 bg-emerald-300/5"
            style={{
                left: centerX - boxWidth / 2,
                top: centerY - boxHeight / 2,
                width: boxWidth,
                height: boxHeight,
                transform: `rotate(${rotation}rad)`,
                touchAction: 'none',
            }}
        >
            <div
                aria-label={t('clip.rotation')}
                onPointerDown={event => drag(event, 'rotate')}
                className="absolute -top-6 left-1/2 h-3 w-3 -translate-x-1/2 cursor-grab rounded-full border border-emerald-200 bg-emerald-500"
            />
            <div
                aria-label={t('handles.scale')}
                onPointerDown={event => drag(event, 'scale')}
                className="absolute -right-1.5 -bottom-1.5 h-3 w-3 cursor-nwse-resize border border-emerald-200 bg-emerald-500"
            />
        </div>
    );
}
