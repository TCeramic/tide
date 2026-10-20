// src/packs/builtin.ts
// 注册随应用发布的风格包。应用入口、测试、离线渲染都先导入这个模块。
// 包是自动发现的：src/packs/<id>/pack.ts 默认导出一个实现 StylePack 契约的对象即可，不需要改这里。
// 以 `_` 开头的目录（如 `_compat`）是共享代码，不是包。
import type { StylePack } from './contract';
import { hasPack, registerPack } from './registry';

const modules = import.meta.glob<{ default?: StylePack }>(['./*/pack.ts', '!./_*/pack.ts'], { eager: true });

const discovered = Object.entries(modules).map(([path, module]) => {
    if (!module.default) throw new Error(`${path} 没有默认导出风格包`);
    const folder = path.split('/')[1];
    if (module.default.id !== folder) throw new Error(`${path} 的包 id（${module.default.id}）应与目录名一致`);
    return module.default;
});

/** 界面上的顺序：order 小的在前，没写 order 的排在最后（按 id）；第一个是找不到指定包时的退路。 */
export const discoveredPacks: StylePack[] = discovered.sort((a, b) => (
    (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id)
));

for (const pack of discoveredPacks) {
    if (!hasPack(pack.id)) registerPack(pack);
}
