// 风格包必须在任何工程数据创建之前注册。
import './packs/builtin';
// 界面语言要在任何组件渲染之前初始化。
import './i18n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import { App } from './App';
import { DerivedProvider } from './app/DerivedProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <DerivedProvider>
        <App />
      </DerivedProvider>
    </MotionConfig>
  </StrictMode>,
);

// 开发模式下的调试句柄：在浏览器控制台或自动化测试里直接调用应用自己的模块实例。
if (import.meta.env.DEV) {
  void Promise.all([
    import('./project/actions'),
    import('./project/session'),
    import('./project/store'),
    import('./app/playback'),
  ]).then(([actions, session, store, playback]) => {
    (window as unknown as { __lumiDebug: unknown }).__lumiDebug = { actions, session, store, playback };
  });
}
