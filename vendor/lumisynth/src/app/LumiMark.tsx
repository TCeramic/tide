// src/app/LumiMark.tsx
// lumisynth 的标志：一束光射入棱镜、折射后按灰度散开（黑白的色散）。线条版，颜色跟随 currentColor；
// 带黑底方块的应用图标见 public/favicon.svg 与 build/icon.svg。
export function LumiMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
            <g stroke="currentColor" strokeLinecap="round" fill="none" strokeWidth="5">
                <path d="M2 48 L16.2 34.6" />
                <path d="M39.4 29.8 L62 26" />
                <path d="M39.4 29.8 L62 38" strokeOpacity=".6" />
                <path d="M39.4 29.8 L62 50" strokeOpacity=".3" />
            </g>
            <path d="M29 9 L48 47 H10 Z" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" />
        </svg>
    );
}
