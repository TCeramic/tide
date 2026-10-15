# Tide UI development

- 用户已明确要求透镜 Lens、点阵 Lattice 直接复用 MIT 上游源码，不再自行模仿。
- 上游为 https://github.com/ruiqichenbiec/design-systems 。完整包及许可在
  `src/renderer/vendor/design-systems/`，固定提交见 manifest.json。
- 后续 UI 优先用上游组件、材质、渲染器和物理交互；适配播放器业务时在
  `native-shell.js`、`native-shell.css` 或业务组件中写绑定，保持 vendor 源码原样。
- 必须保留 MIT 和 third-party 版权声明。新增或升级上游文件时同步 manifest。
- 透镜与点阵是完整设计系统外壳；设置中的播放环境层开关是独立功能。
- 本次只重做透镜和点阵。序曲是同一上游的第三套系统，尚未加入播放器预设。
- 验证：`npm run verify:design-systems`、`npm run typecheck`、`npm test`、
  `npm run build`，并在渲染页面验证两套预设和原版完整组件展示。
