// 让 t() 的键按中文字典做类型检查：写错的键、没加进字典的键编译不过。
import type zh from './locales/zh';

declare module 'i18next' {
    interface CustomTypeOptions {
        defaultNS: 'common';
        resources: typeof zh;
        returnNull: false;
    }
}
