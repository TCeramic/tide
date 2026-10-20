// Vite 的 ?raw 导入：文件内容作为字符串（剧本的语法说明、agent 的 skill 由此打进页面）。
declare module '*?raw' {
    const text: string;
    export default text;
}
