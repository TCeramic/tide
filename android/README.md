# Tide Android 0.3.1 测试版

最低 Android 8.0（API 26），target SDK 35。使用系统 WebView 展示与桌面共用的 Lens/Lattice 组件、Paper Shader、Liquid Metal 与三维音乐脉络；音频由原生 MediaPlayer、前台服务与 MediaSession 管理，离开界面仍可播放。需要更新的 Android System WebView。无 JNI，可安装到不同 ABI 的设备；音频格式支持取决于系统解码器。

本轮变化：
- 用与桌面一致的搜索栏、封面卡片、点阵与透镜主题、可调配色、播放器和歌词页替换首版原生按钮界面。
- 增加 MP3 ID3 APIC/FLAC 内嵌封面回退，修复加载完成时清掉已经取得的媒体封面；补全 MediaSession 的三种 artwork 字段，旧音乐库可自动补封面。
- 增加网易云二维码与验证码登录、账号歌单、搜索、每日推荐。登录凭据留在本机；是否成功仍受服务端状态影响。验证码只在用户按发送按钮时请求。
- 保留 SAF 文件导入、喜欢、队列、循环/随机、LRC、通知/耳机/锁屏控制。

手机版没有小窗播放器和桌面歌词，不申请悬浮窗权限。复杂的商籁/绘光歌词舞台尚未实现。

## 安装与验证状态

`release/android/Tide-Android-0.3.1.apk` 使用与 0.1.0 相同的本地分发签名，可覆盖安装。不要卸载旧版，以便保留已导入的 URI 授权和音乐库。

已验证：Java 编译、资源/网页打包、APK 签名，内嵌封面解析和 LRC 单元检查，以及桌面浏览器中的真实共享网页渲染、路由、二维码、播放桥接和多尺寸布局。浏览器中的播放桥接使用测试数据，不代表 Android 播放服务已实测。

当前没有可连接的 Android 设备，本轮 APK 尚未完成一加 Ace 3 / ColorOS 16 实机验证。用户此前反馈 0.1.0 的系统媒体卡可以运行；0.2.0 的封面、登录与后台行为需要继续实机确认。专用流体云卡需要 OPPO 平台资质/SDK配置，目前接入的是标准媒体会话，不能把系统显示媒体卡等同于专用流体云认证。

## 构建

JDK 17+、Node.js 与项目依赖、Python 3，官方 Android SDK `platforms;android-35`、`build-tools;35.0.0`。设置 JAVA_HOME / ANDROID_SDK_ROOT 后运行：

```powershell
python scripts/build-android.py
```

脚本先构建共享网页，再调用 aapt2、javac、D8、zipalign 和 apksigner。私钥与随机签名密码只保存在忽略目录 `artifacts/android-signing/`，不要上传；保留它才能继续覆盖升级。第三方授权文件已放在 APK assets/web/licenses 内。

## 本轮离线界面整理

按用户要求未连接ADB、未继续处理流体云。播放页移除全局搜索栏，保留返回、歌曲菜单和一套播放控制；默认显示封面/歌名/歌手，点击进入完整歌词，浏览页面保留底部dock。设置按外观、动画、自定义配色整理，删除重复账号入口、技术说明及点集手动按钮。已在真实APK网页资源上做浏览器多尺寸/双主题交互检查；这些检查不等同于新增实机结论。流体云独立喜欢按钮仍未解决，二维码环境限制仍需后续实测。
