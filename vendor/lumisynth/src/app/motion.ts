// src/app/motion.ts
// 界面动效的共用参数（motion / framer-motion）。浮层进出都要短：编辑器里弹窗是高频操作，慢了反而碍事。
// 系统开了“减少动态效果”时由 main.tsx 的 MotionConfig 关掉位移与缩放，只留淡入淡出。
import type { Transition, Variants } from 'motion/react';

/** 浮层（命令面板、菜单、对话框）进出。 */
export const popTransition: Transition = { duration: 0.14, ease: [0.2, 0, 0, 1] };

/** 指示条、分段按钮的滑块在选项之间滑动。 */
export const indicatorSpring: Transition = { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 };

/** 抽屉、侧向滑入的面板。 */
export const sheetSpring: Transition = { type: 'spring', stiffness: 420, damping: 40 };

/**
 * 透明的全屏接点层（点外面关闭用）：自己不动，只在退场时立刻不挡点击——子元素还在淡出，
 * 这时点下面的界面不该被吞掉。子元素的 variants 跟着它的 initial / animate / exit 走。
 */
export const overlay: Variants = {
    hidden: {},
    visible: { pointerEvents: 'auto' },
    exit: { pointerEvents: 'none' },
};

/** 半透明的暗色遮罩：淡入淡出，退场时同样立刻放行点击。 */
export const backdrop: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, pointerEvents: 'auto' },
    exit: { opacity: 0, pointerEvents: 'none' },
};

/** 从上方落下的面板（命令面板、快速选择、下拉菜单）。 */
export const dropDown: Variants = {
    hidden: { opacity: 0, y: -6, scale: 0.98 },
    visible: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -4, scale: 0.98 },
};

/** 原地弹出的面板（右键菜单、对话框）。 */
export const popIn: Variants = {
    hidden: { opacity: 0, scale: 0.96 },
    visible: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.97 },
};

/** 切换视图时内容轻轻淡入。只动透明度：容器上留着 transform 会让里面 position: fixed 的弹层错位。 */
export const fadeIn = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { duration: 0.16, ease: 'easeOut' },
} as const;

/** 给 motion 组件的 initial / animate / exit 三件套。 */
export const presence = { initial: 'hidden', animate: 'visible', exit: 'exit' } as const;
