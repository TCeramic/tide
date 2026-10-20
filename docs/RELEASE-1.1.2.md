# Tide 1.1.2

修正 1.1.1 里播放行为改过头的问题。

## 本次修复

- 只有**搜索结果**按「插到当前曲目后面再播」处理：在搜索页点播放按钮、双击、右键菜单「播放」、「开始播放」都不会再把正在听的歌单顶掉。
- 今日潮汐、每日推荐、私人雷达、私人 FM、歌手/专辑详情、本地音乐等列表恢复原行为：点一首就按整列替换播放队列。

## 发布要求

- tag 必须是 `v1.1.2`；资产名 `Tide-Setup-1.1.2-x64.exe`（优先）或 `Tide-1.1.2-win.zip`（回退），附 `SHA256SUMS.txt`。

## 验证

- `npm run typecheck` 通过；`npm test` 182 pass / 0 fail。
- `node scripts/build.mjs` 重建 dist；打包产物内的 `dist/renderer.js` 已包含 `source || !insertOnly` 判定。
