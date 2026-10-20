// src/app/script/scriptImport.ts
// 「文件 › 导入剧本或设置…」：选好的文件交给剧本标签页（它负责判断放进「剧本」还是「设置」视图）。
// 标签页还没打开时先存着，打开后取走。
type Listener = (file: File) => void;

let pending: File | null = null;
let listener: Listener | null = null;

export const requestScriptImport = (file: File) => {
    if (listener) listener(file);
    else pending = file;
};

/** 剧本标签页挂载时调用；返回取消订阅。 */
export const onScriptImport = (next: Listener) => {
    listener = next;
    if (pending) {
        const file = pending;
        pending = null;
        next(file);
    }
    return () => {
        if (listener === next) listener = null;
    };
};
