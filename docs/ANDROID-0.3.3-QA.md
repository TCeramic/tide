# Android 0.3.3 QA 记录

日期：2026-10-19

设备：OnePlus Ace 3（PJE110），ColorOS 16，Android 16。

包名/版本：`dev.tide.android` / `0.3.3`

## 构建产物

- APK：`release/android/Tide-Android-0.3.3.apk`（2,983,907 bytes）
- SHA-256：`cfc0cb64bc4478364eda99130fcf07ca0271c2d184a2dc9322ec59f18912fc4e`
- 摘要文件：`release/android/SHA256SUMS.txt`
- `apksigner verify --verbose`：通过，v2、v3 签名有效。
- `adb install -r`：通过，保留应用数据。安装命令本身未启动客户端或发送登录请求；随后由用户手动启动并完成登录复测。

## 自动化回归

以下结果由对应回归代理在当前共享源码上执行并回报：

- `node scripts/android-auth-smoke.cjs`：通过，`ANDROID_AUTH_FAVORITE_AND_QR_REGRESSIONS passed`。
- `node scripts/android-request-envelope-smoke.cjs`：通过，`ANDROID_CLOUD_REQUEST_ENVELOPES passed`；4 个请求由本地拦截器验证，未访问网络、发送短信或输出凭据。
- `node scripts/android-ui-smoke.cjs`：通过，`ANDROID_SHARED_RENDERERS_ROUTES_QR_BRIDGE_LYRICS_AND_RESPONSIVE_UI passed`。
- `node scripts/android-daily-restore-smoke.cjs`：通过，`ANDROID_DAILY_RECOMMEND_TODAY_CACHE_ACCOUNT_INVALIDATION_PAUSED_LYRICS passed`。
- `python scripts/build-android.py`：通过；Java 编译、APK v2/v3 签名及归档完整性检查通过。
- `npm run typecheck`：通过。
- `git diff --check`：通过；Git 仅提示部分 Android 源文件的 LF/CRLF 工作树换行转换警告。

## 实机验证

- 生产 WebView 页面 `https://tide.local/index.html` 已加载；`window.TideMobile` 和 `window.TideNative.dispatch` 均可用。
- 喜欢状态：先确认当前账号已有权威喜欢列表，再只对列表第一首已喜欢歌曲发送幂等 `like=true`。网易云返回 `code=200`，`alreadyLiked=true`、`stillLiked=true`。没有执行取消喜欢，也未输出歌曲 ID、账号标识或 Cookie。
- 每日推荐：原生 `daily-recommend` 返回 33 首。
- 登录 E2E（用户实机确认）：安装本构建后，用户手动完成二维码登录和手机号验证码登录，均确认成功。自动化没有发送短信或替用户执行登录；没有记录二维码 key、Cookie 或账号凭据。
- 登录请求实现：普通 WEAPI 使用原 Android Chrome 120.0 UA；喜欢请求保留独立 UA 和 upstream Cookie defaults；二维码 key/check 使用独立 EAPI envelope，匹配仓库固定的 NeteaseCloudMusicApi 4.32.0 默认请求头，并保留 Cookie 中已有的 `os` 元数据。手动登录成功验证了最终行为；请求头调整的单一因果关系未单独验证。
- 安装时 Codex 只执行 `adb install -r` 并保留应用数据；随后由用户自行启动并完成登录复测。
- 最近一次原生状态快照为暂停、位置 `0 ms`、歌词 `55` 行。较早快照为位置 `51,434 ms`、歌词 `36` 行，两次观测不一致；冷启动暂停恢复尚未受控验证，因此不据此判定恢复行为。
- 整个实机验证期间未通过测试脚本发送播放、暂停、切歌或 seek 命令。
