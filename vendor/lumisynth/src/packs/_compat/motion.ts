// src/packs/_compat/motion.ts
// 引擎只用 framer-motion 的 MotionValue 类型并只调用 .get()，这里给出最小接口。
export interface MotionValue<T> {
  get(): T;
}
