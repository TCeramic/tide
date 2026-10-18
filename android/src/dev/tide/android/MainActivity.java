package dev.tide.android;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public class MainActivity extends Activity {
  private final Handler ui = new Handler(Looper.getMainLooper());
  private final ExecutorService jobs = Executors.newFixedThreadPool(2);
  private android.content.SharedPreferences prefs;
  private FrameLayout root;
  private WebView mobile;
  private boolean webReady;
  private long smsAfter;
  private final ArrayList<Song> collectionRows = new ArrayList<>();
  private LinearLayout shell, body, dock;
  private Backdrop backdrop;
  private TextView dockTitle, dockPlay, lyric, following, timer;
  private SeekBar seek;
  private ImageView cover;
  private ScrollView scroll;
  private int ink, muted, accent;
  private boolean alive, resumed, seeking;
  private String page = "home", shownArt = "", searchKey = "";
  private Bitmap art;
  private String displayedSongId = "";
  private int request;
  private ArrayList<Song> library, favorites, results = new ArrayList<>();
  private final LinkedHashMap<String, Bitmap> covers =
      new LinkedHashMap<String, Bitmap>(12, .75f, true) {
        protected boolean removeEldestEntry(Map.Entry<String, Bitmap> e) {
          return size() > 12;
        }
      };
  private final BroadcastReceiver receiver =
      new BroadcastReceiver() {
        public void onReceive(Context c, Intent i) {
          refresh();
        }
      };
  private final Runnable tick =
      new Runnable() {
        public void run() {
          if (!resumed) return;
          refreshProgress();
          ui.postDelayed(this, 350);
        }
      };

  public void onCreate(Bundle saved) {
    super.onCreate(saved);
    alive = true;
    CookieManager.getInstance();
    prefs = getSharedPreferences("tide", 0);
    library = Song.read(this, "library");
    favorites = Song.read(this, "favorites");
    if (saved != null) page = saved.getString("page", "home");
    if (Build.VERSION.SDK_INT >= 33)
      registerReceiver(
          receiver, new IntentFilter(PlaybackService.UPDATE), Context.RECEIVER_NOT_EXPORTED);
    else registerReceiver(receiver, new IntentFilter(PlaybackService.UPDATE));
    render();
    repairArtwork();
    if (Build.VERSION.SDK_INT >= 33
        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED)
      requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 22);
  }

  protected void onSaveInstanceState(Bundle b) {
    b.putString("page", page);
    super.onSaveInstanceState(b);
  }

  protected void onResume() {
    super.onResume();
    resumed = true;
    if (mobile != null) {
      mobile.onResume();
      mobile.evaluateJavascript("window.TideMobile&&TideMobile.setActive(true)", null);
    }
    if (backdrop != null) backdrop.active(true);
    ui.removeCallbacks(tick);
    ui.post(tick);
    refresh();
  }

  protected void onPause() {
    resumed = false;
    if (mobile != null) {
      mobile.evaluateJavascript("window.TideMobile&&TideMobile.setActive(false)", null);
      mobile.onPause();
    }
    ui.removeCallbacks(tick);
    if (backdrop != null) backdrop.active(false);
    super.onPause();
  }

  protected void onDestroy() {
    alive = false;
    request++;
    unregisterReceiver(receiver);
    ui.removeCallbacksAndMessages(null);
    jobs.shutdownNow();
    if (mobile != null) {
      mobile.removeJavascriptInterface("TideNative");
      mobile.destroy();
      mobile = null;
    }
    super.onDestroy();
  }

  private int dp(float x) {
    return Math.round(x * getResources().getDisplayMetrics().density);
  }

  private void toast(String s) {
    Toast.makeText(this, s, Toast.LENGTH_LONG).show();
  }

  private LinearLayout vertical() {
    LinearLayout l = new LinearLayout(this);
    l.setOrientation(LinearLayout.VERTICAL);
    return l;
  }

  private TextView text(String value, float size, int color) {
    TextView t = new TextView(this);
    t.setText(value);
    t.setTextSize(size);
    t.setTextColor(color);
    t.setIncludeFontPadding(false);
    t.setPadding(0, dp(4), 0, dp(4));
    return t;
  }

  private GradientDrawable panel(int color, int radius) {
    GradientDrawable d = new GradientDrawable();
    d.setColor(color);
    d.setCornerRadius(dp(radius));
    d.setStroke(dp(1), prefs.getBoolean("light", false) ? 0x1c143346 : 0x26ffffff);
    return d;
  }

  private TextView button(String label, Runnable action) {
    TextView b = text(label, 15, ink);
    b.setGravity(Gravity.CENTER);
    b.setMinHeight(dp(48));
    b.setPadding(dp(12), dp(8), dp(12), dp(8));
    b.setBackground(panel(prefs.getBoolean("light", false) ? 0xa8ffffff : 0x9c1a293c, 16));
    b.setContentDescription(label);
    b.setOnClickListener(v -> action.run());
    return b;
  }

  private void gap(LinearLayout l, int n) {
    Space s = new Space(this);
    l.addView(s, new LinearLayout.LayoutParams(1, dp(n)));
  }

  private void addButton(LinearLayout l, String label, Runnable action) {
    TextView b = button(label, action);
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.bottomMargin = dp(8);
    l.addView(b, p);
  }

  private void navigate(String target) {
    page = target;
    render();
  }

  private void render() {
    try {
      renderMobile();
      return;
    } catch (Exception ignored) {
      mobile = null;
    }

    boolean light = prefs.getBoolean("light", false);
    ink = light ? 0xff153447 : 0xfff2f6fb;
    muted = light ? 0xff506577 : 0xffa8baca;
    accent = prefs.getInt("accent", 0xff68cde2);
    lyric = null;
    following = null;
    timer = null;
    seek = null;
    cover = null;
    shownArt = "";
    root = new FrameLayout(this);
    backdrop = new Backdrop(this);
    backdrop.light = light;
    backdrop.pixel = prefs.getString("background", "flow").equals("pixel");
    backdrop.still = prefs.getBoolean("still", false);
    backdrop.accent = accent;
    backdrop.cover = art;
    root.addView(backdrop, new FrameLayout.LayoutParams(-1, -1));
    shell = vertical();
    shell.setPadding(dp(18), 0, dp(18), 0);
    FrameLayout.LayoutParams centered =
        new FrameLayout.LayoutParams(dp(760), -1, Gravity.CENTER_HORIZONTAL);
    if (getResources().getConfiguration().screenWidthDp < 796) centered.width = -1;
    root.addView(shell, centered);
    root.setOnApplyWindowInsetsListener(
        (v, insets) -> {
          if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets safe =
                insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            shell.setPadding(dp(18) + safe.left, safe.top, dp(18) + safe.right, safe.bottom);
          } else
            shell.setPadding(
                dp(18) + insets.getSystemWindowInsetLeft(),
                insets.getSystemWindowInsetTop(),
                dp(18) + insets.getSystemWindowInsetRight(),
                insets.getSystemWindowInsetBottom());
          return insets;
        });
    getWindow().setStatusBarColor(Color.TRANSPARENT);
    getWindow().setNavigationBarColor(light ? 0xffe5edf0 : 0xff0c1524);
    getWindow()
        .getDecorView()
        .setSystemUiVisibility(
            light
                ? View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                : 0);
    setContentView(root);
    LinearLayout top = new LinearLayout(this);
    top.setGravity(Gravity.CENTER_VERTICAL);
    TextView home = button(page.equals("home") ? "TIDE" : "‹ 主页", () -> navigate("home"));
    top.addView(home, new LinearLayout.LayoutParams(0, dp(50), 1));
    TextView settings = button("设置", () -> navigate("settings"));
    LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(dp(76), dp(50));
    sp.leftMargin = dp(10);
    top.addView(settings, sp);
    shell.addView(top);
    gap(shell, 12);
    scroll = new ScrollView(this);
    scroll.setFillViewport(false);
    scroll.setClipToPadding(false);
    body = vertical();
    body.setPadding(dp(2), dp(8), dp(2), dp(18));
    scroll.addView(body, new ScrollView.LayoutParams(-1, -2));
    shell.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
    switch (page) {
      case "library":
        listPage("本地音乐", library, true);
        break;
      case "favorites":
        listPage("喜欢的音乐", favorites, false);
        break;
      case "search":
        searchPage();
        break;
      case "playing":
        playingPage();
        break;
      case "settings":
        settingsPage();
        break;
      default:
        homePage();
    }
    dock = new LinearLayout(this);
    dock.setGravity(Gravity.CENTER_VERTICAL);
    dock.setPadding(dp(12), dp(8), dp(4), dp(8));
    dock.setBackground(panel(light ? 0xc8ffffff : 0xda172738, 20));
    dockTitle = text("选择一首音乐开始", 14, ink);
    dockTitle.setMaxLines(2);
    dockTitle.setOnClickListener(v -> navigate("playing"));
    dock.addView(dockTitle, new LinearLayout.LayoutParams(0, dp(48), 1));
    dockPlay = button("▶", () -> toggle());
    dock.addView(dockPlay, new LinearLayout.LayoutParams(dp(54), dp(48)));
    dock.addView(
        button(
            "›",
            () -> {
              if (service() != null) service().next(1);
            }),
        new LinearLayout.LayoutParams(dp(46), dp(48)));
    LinearLayout.LayoutParams d = new LinearLayout.LayoutParams(-1, -2);
    d.topMargin = dp(8);
    d.bottomMargin = dp(10);
    shell.addView(dock, d);
    backdrop.active(resumed);
    root.requestApplyInsets();
    refresh();
  }

  private void heading(String title, String subtitle) {
    TextView h = text(title, 30, ink);
    h.setTypeface(null, 1);
    body.addView(h);
    body.addView(text(subtitle, 13, muted));
    gap(body, 20);
  }

  private void homePage() {
    heading("潮汐，随音乐而动", "原生安卓客户端 · 让音乐留在身边");
    PlaybackService s = service();
    if (s != null && s.current() != null)
      addButton(body, "继续播放  ·  " + s.current().title, () -> navigate("playing"));
    addButton(body, "本地音乐  ·  " + library.size() + " 首", () -> navigate("library"));
    addButton(body, "导入音频", () -> importMusic());
    addButton(body, "喜欢的音乐  ·  " + favorites.size() + " 首", () -> navigate("favorites"));
    addButton(body, "搜索音乐、歌手", () -> navigate("search"));
    gap(body, 14);
    body.addView(text("支持系统文件选择器导入、后台播放、锁屏与耳机控制。", 14, muted));
  }

  private void listPage(String title, ArrayList<Song> rows, boolean local) {
    heading(title, rows.size() + " 首音乐");
    if (local) addButton(body, "＋ 导入音频", () -> importMusic());
    if (rows.isEmpty()) body.addView(text("这里还没有音乐。导入本地文件，或在搜索中添加喜欢的歌曲。", 16, muted));
    else {
      addButton(body, "播放全部", () -> start(rows, 0));
      for (int i = 0; i < rows.size(); i++) songRow(rows, i);
    }
  }

  private void songRow(ArrayList<Song> songs, int at) {
    Song song = songs.get(at);
    LinearLayout row = new LinearLayout(this);
    row.setGravity(Gravity.CENTER_VERTICAL);
    row.setPadding(dp(12), dp(9), dp(8), dp(9));
    row.setBackground(panel(prefs.getBoolean("light", false) ? 0x8cffffff : 0x8c19283a, 17));
    LinearLayout labels = vertical();
    TextView name = text(song.title, 17, ink);
    name.setMaxLines(2);
    labels.addView(name);
    TextView sub = text(song.artist, 13, muted);
    sub.setMaxLines(1);
    labels.addView(sub);
    row.addView(labels, new LinearLayout.LayoutParams(0, -2, 1));
    labels.setOnClickListener(v -> start(songs, at));
    row.addView(
        button("•••", () -> songOptions(song)), new LinearLayout.LayoutParams(dp(48), dp(48)));
    row.setOnClickListener(v -> start(songs, at));
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.bottomMargin = dp(9);
    body.addView(row, p);
  }

  private void songOptions(Song s) {
    boolean liked = isLiked(s);
    ArrayList<String> actions = new ArrayList<>(Arrays.asList(liked ? "取消喜欢" : "喜欢这首", "下一首播放"));
    if (!s.uri.isEmpty()) {
      actions.add("导入此曲 LRC 歌词");
      actions.add("从曲库移除（保留文件）");
    }
    new AlertDialog.Builder(this)
        .setTitle(s.title)
        .setItems(
            actions.toArray(new String[0]),
            (d, i) -> {
              if (i == 0) {
                favorite(s);
                render();
              } else if (i == 1) {
                PlaybackService p = service();
                if (p == null) {
                  ArrayList<Song> a = new ArrayList<>();
                  a.add(s);
                  start(a, 0);
                } else {
                  p.queue.add(Math.min(p.queue.size(), p.index + 1), s);
                  Song.save(this, "queue", p.queue);
                  toast("已加入下一首");
                }
              } else if (i == 2) {
                prefs.edit().putString("lrcSong", s.id).apply();
                Intent f =
                    new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .setType("*/*")
                        .addCategory(Intent.CATEGORY_OPENABLE);
                startActivityForResult(f, 73);
              } else {
                library.removeIf(x -> x.id.equals(s.id));
                Song.save(this, "library", library);
                render();
              }
            })
        .show();
  }

  private boolean isLiked(Song s) {
    for (Song x : favorites) if (x.id.equals(s.id)) return true;
    return false;
  }

  private void favorite(Song s) {
    if (isLiked(s)) favorites.removeIf(x -> x.id.equals(s.id));
    else favorites.add(s);
    Song.save(this, "favorites", favorites);
  }

  private void searchPage() {
    heading("发现音乐", "搜索结果与可播放范围取决于音源及账号权限");
    EditText input = new EditText(this);
    input.setSingleLine(true);
    input.setTextColor(ink);
    input.setHintTextColor(muted);
    input.setHint("歌名 / 歌手");
    input.setText(searchKey);
    input.setPadding(dp(12), dp(10), dp(12), dp(10));
    input.setBackground(panel(prefs.getBoolean("light", false) ? 0xc0ffffff : 0xc01a293c, 16));
    body.addView(input, new LinearLayout.LayoutParams(-1, dp(52)));
    gap(body, 8);
    addButton(
        body,
        "搜索",
        () -> {
          searchKey = input.getText().toString().trim();
          if (searchKey.isEmpty()) return;
          results.clear();
          runSearch(0);
        });
    for (int i = 0; i < results.size(); i++) songRow(results, i);
    if (!results.isEmpty()) addButton(body, "加载更多", () -> runSearch(results.size()));
  }

  private void runSearch(int offset) {
    int token = ++request;
    toast("正在搜索…");
    String key = searchKey;
    jobs.execute(
        () -> {
          try {
            ArrayList<Song> found = new Cloud(this).search(key, offset);
            ui.post(
                () -> {
                  if (!alive || token != request) return;
                  results.addAll(found);
                  if (found.isEmpty()) toast("没有更多结果");
                  if (page.equals("search")) render();
                });
          } catch (Exception e) {
            ui.post(
                () -> {
                  if (alive && token == request) toast(e.getMessage());
                });
          }
        });
  }

  private PlaybackService service() {
    return PlaybackService.instance;
  }

  private void start(List<Song> songs, int at) {
    try {
      PlaybackService.start(this, songs, at);
      navigate("playing");
    } catch (Exception e) {
      toast("启动播放失败：" + e.getMessage());
    }
  }

  private void toggle() {
    PlaybackService p = service();
    if (p == null) {
      if (!library.isEmpty()) start(library, 0);
      else toast("请先选择音乐");
    } else if (p.playing) p.pause();
    else p.resume();
  }

  private void playingPage() {
    PlaybackService s = service();
    Song song = s == null ? null : s.current();
    displayedSongId = song == null ? "" : song.id;
    heading("正在播放", song == null ? "从本地曲库或搜索选择音乐" : song.artist);
    cover = new ImageView(this);
    cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
    cover.setBackground(panel(0x402c6078, 26));
    cover.setClipToOutline(true);
    int width = getResources().getConfiguration().screenWidthDp;
    int h = getResources().getConfiguration().screenHeightDp;
    int side = Math.min(340, Math.min(width - 52, Math.max(150, h / 3)));
    LinearLayout.LayoutParams cp = new LinearLayout.LayoutParams(dp(side), dp(side));
    cp.gravity = Gravity.CENTER_HORIZONTAL;
    body.addView(cover, cp);
    gap(body, 18);
    TextView title = text(song == null ? "潮汐 Tide" : song.title, 24, ink);
    title.setGravity(Gravity.CENTER);
    title.setTypeface(null, 1);
    body.addView(title);
    gap(body, 14);
    lyric = text("等待音乐响起", 21, ink);
    lyric.setGravity(Gravity.CENTER);
    lyric.setMinHeight(dp(58));
    lyric.setMaxLines(3);
    body.addView(lyric);
    following = text("", 16, muted);
    following.setGravity(Gravity.CENTER);
    following.setMinHeight(dp(42));
    following.setMaxLines(2);
    body.addView(following);
    gap(body, 14);
    seek = new SeekBar(this);
    seek.setMax(1000);
    seek.setProgressTintList(android.content.res.ColorStateList.valueOf(accent));
    seek.setThumbTintList(android.content.res.ColorStateList.valueOf(accent));
    seek.setContentDescription("歌曲进度");
    seek.setOnSeekBarChangeListener(
        new SeekBar.OnSeekBarChangeListener() {
          public void onStartTrackingTouch(SeekBar b) {
            seeking = true;
          }

          public void onStopTrackingTouch(SeekBar b) {
            if (service() != null) service().seek(service().duration() * b.getProgress() / 1000);
            seeking = false;
          }

          public void onProgressChanged(SeekBar b, int p, boolean u) {}
        });
    body.addView(seek, new LinearLayout.LayoutParams(-1, dp(48)));
    timer = text("0:00 / 0:00", 13, muted);
    timer.setGravity(Gravity.CENTER);
    body.addView(timer);
    LinearLayout controls = new LinearLayout(this);
    controls.setGravity(Gravity.CENTER);
    for (String action : new String[] {"‹ 上一首", "播放 / 暂停", "下一首 ›"}) {
      TextView b =
          button(
              action,
              () -> {
                if (action.startsWith("‹")) {
                  if (service() != null) service().next(-1);
                } else if (action.startsWith("下一")) {
                  if (service() != null) service().next(1);
                } else toggle();
              });
      LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(0, dp(56), 1);
      bp.setMargins(dp(3), dp(10), dp(3), dp(8));
      controls.addView(b, bp);
    }
    body.addView(controls);
    addButton(
        body,
        "♡ 喜欢 / 取消喜欢",
        () -> {
          if (service() != null && service().current() != null) {
            favorite(service().current());
            toast(isLiked(service().current()) ? "已喜欢" : "已取消喜欢");
          }
        });
    addButton(
        body,
        "播放顺序：" + prefs.getString("repeat", "list"),
        () ->
            new AlertDialog.Builder(this)
                .setTitle("播放顺序")
                .setItems(
                    new String[] {"列表循环", "单曲循环", "随机播放"},
                    (d, i) -> {
                      prefs
                          .edit()
                          .putString("repeat", new String[] {"list", "one", "shuffle"}[i])
                          .apply();
                      render();
                    })
                .show());
  }

  private String clock(long ms) {
    return String.format(Locale.ROOT, "%d:%02d", ms / 60000, ms / 1000 % 60);
  }

  private void refreshProgress() {
    if (mobile != null) {
      pushPosition();
      return;
    }
    PlaybackService p = service();
    if (p == null) return;
    if (seek != null && !seeking)
      seek.setProgress(p.duration() > 0 ? (int) (p.position() * 1000 / p.duration()) : 0);
    if (timer != null) timer.setText(clock(p.position()) + " / " + clock(p.duration()));
    if (lyric != null) {
      int i = Lyrics.index(p.lyrics, p.position());
      lyric.setText(
          !p.error.isEmpty()
              ? p.error
              : p.loading
                  ? "正在加载…"
                  : p.lyrics.isEmpty() ? "纯音乐或暂无歌词" : i < 0 ? "前奏" : p.lyrics.get(i).text);
      following.setText(i + 1 < p.lyrics.size() ? p.lyrics.get(i + 1).text : "");
    }
  }

  private void refresh() {
    if (mobile != null) {
      pushMobileState();
      return;
    }
    if (dockTitle == null) return;
    PlaybackService p = service();
    Song s = p == null ? null : p.current();
    dockTitle.setText(
        s == null
            ? "选择一首音乐开始"
            : s.title + "\n" + (p.loading ? "正在加载…" : p.error.isEmpty() ? s.artist : p.error));
    dockPlay.setText(p != null && p.playing ? "Ⅱ" : "▶");
    if (page.equals("playing") && s != null && !displayedSongId.equals(s.id)) {
      render();
      return;
    }
    if (s != null && !shownArt.equals(s.cover)) {
      shownArt = s.cover;
      String key = s.cover;
      Bitmap cached = covers.get(key);
      if (cached != null) {
        applyArt(cached);
      } else if (!key.isEmpty())
        jobs.execute(
            () -> {
              Bitmap b = Artwork.load(this, key, 512);
              ui.post(
                  () -> {
                    if (alive && b != null) {
                      covers.put(key, b);
                      if (shownArt.equals(key)) applyArt(b);
                    }
                  });
            });
    }
    refreshProgress();
  }

  private void applyArt(Bitmap b) {
    art = b;
    if (cover != null) cover.setImageBitmap(b);
    if (backdrop != null) {
      backdrop.cover = b;
      backdrop.invalidate();
    }
  }

  private void settingsPage() {
    heading("设置", "适配触屏与系统媒体控制");
    addButton(
        body,
        "明暗模式：" + (prefs.getBoolean("light", false) ? "明亮" : "深色"),
        () -> {
          prefs.edit().putBoolean("light", !prefs.getBoolean("light", false)).apply();
          render();
        });
    addButton(
        body,
        "背景：" + prefs.getString("background", "flow"),
        () ->
            new AlertDialog.Builder(this)
                .setTitle("背景")
                .setItems(
                    new String[] {"流动配色", "像素封面", "静态配色"},
                    (d, i) -> {
                      prefs
                          .edit()
                          .putString("background", i == 1 ? "pixel" : "flow")
                          .putBoolean("still", i == 2)
                          .apply();
                      render();
                    })
                .show());
    addButton(body, "主题配色与实时预览", () -> palette());
    addButton(body, "网易云账号登录", () -> login());
    addButton(
        body,
        "退出网易云账号",
        () ->
            new AlertDialog.Builder(this)
                .setTitle("清除本客户端的登录状态？")
                .setPositiveButton(
                    "退出",
                    (d, i) -> CookieManager.getInstance().removeAllCookies(ok -> toast("已退出账号")))
                .setNegativeButton("取消", null)
                .show());
    addButton(
        body,
        "ColorOS 流体云",
        () ->
            new AlertDialog.Builder(this)
                .setTitle("ColorOS 系统联动")
                .setMessage(
                    "已提供标准 MediaSession 和媒体通知，支持系统播放面板、锁屏和耳机控制。\n\n"
                        + "专用流体云卡片需要 OPPO 开发者平台配置、对应 SDK/UPK 及部分场景白名单。当前未集成未经认证的私有接口，也尚未通过 ColorOS"
                        + " 真机验证。具体显示形态由系统版本决定。")
                .setPositiveButton("了解", null)
                .show());
    gap(body, 12);
    body.addView(
        text(
            "潮汐 Tide Android 0.1.0\n"
                + "Android 8.0 及以上 · 原生通用 APK\n"
                + "手机版不包含小窗播放器与桌面歌词。\n"
                + "本地曲库使用系统文件选择器，移除歌曲不会删除源文件。",
            14,
            muted));
  }

  private void palette() {
    LinearLayout content = vertical();
    content.setPadding(dp(22), dp(10), dp(22), dp(14));
    TextView preview = text("潮汐 Tide  ♪\n流动与音乐", 25, ink);
    preview.setGravity(Gravity.CENTER);
    content.addView(preview, new LinearLayout.LayoutParams(-1, dp(110)));
    int[] channels = {Color.red(accent), Color.green(accent), Color.blue(accent)};
    Runnable update =
        () -> {
          int color = Color.rgb(channels[0], channels[1], channels[2]);
          preview.setBackground(
              new GradientDrawable(
                  GradientDrawable.Orientation.TL_BR, new int[] {color, 0xff26364d}));
          backdrop.accent = color;
          backdrop.invalidate();
        };
    for (int i = 0; i < 3; i++) {
      final int channel = i;
      content.addView(text(new String[] {"红", "绿", "蓝"}[i], 14, muted));
      SeekBar bar = new SeekBar(this);
      bar.setMax(255);
      bar.setProgress(channels[i]);
      content.addView(bar, new LinearLayout.LayoutParams(-1, dp(48)));
      bar.setOnSeekBarChangeListener(
          new SeekBar.OnSeekBarChangeListener() {
            public void onStartTrackingTouch(SeekBar b) {}

            public void onStopTrackingTouch(SeekBar b) {}

            public void onProgressChanged(SeekBar b, int p, boolean user) {
              channels[channel] = p;
              update.run();
            }
          });
    }
    update.run();
    new AlertDialog.Builder(this)
        .setTitle("主题调色")
        .setView(content)
        .setPositiveButton(
            "保存",
            (d, i) -> {
              prefs
                  .edit()
                  .putInt("accent", Color.rgb(channels[0], channels[1], channels[2]))
                  .apply();
              render();
            })
        .setNegativeButton("取消", (d, i) -> render())
        .setOnCancelListener(d -> render())
        .show();
  }

  private void login() {
    WebView web = new WebView(this);
    web.getSettings().setJavaScriptEnabled(true);
    web.getSettings().setDomStorageEnabled(true);
    web.getSettings().setAllowFileAccess(false);
    web.getSettings().setAllowContentAccess(false);
    CookieManager.getInstance().setAcceptCookie(true);
    web.setWebViewClient(
        new WebViewClient() {
          public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
            Uri u = r.getUrl();
            String h = u.getHost();
            return !"https".equals(u.getScheme())
                || h == null
                || !(h.equals("music.163.com") || h.endsWith(".163.com") || h.endsWith(".126.com"));
          }
        });
    AlertDialog dialog =
        new AlertDialog.Builder(this)
            .setTitle("官方网页登录")
            .setView(web)
            .setPositiveButton(
                "完成",
                (d, i) -> {
                  CookieManager.getInstance().flush();
                  toast("登录状态已保存");
                })
            .setNegativeButton("关闭", null)
            .create();
    dialog.setOnDismissListener(
        d -> {
          web.stopLoading();
          web.destroy();
        });
    dialog.show();
    dialog.getWindow().setLayout(-1, (int) (getResources().getDisplayMetrics().heightPixels * .85));
    web.loadUrl("https://music.163.com/#/login");
  }

  private void importMusic() {
    Intent i =
        new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .setType("audio/*")
            .addCategory(Intent.CATEGORY_OPENABLE)
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            .addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    startActivityForResult(i, 71);
  }

  protected void onActivityResult(int req, int result, Intent data) {
    super.onActivityResult(req, result, data);
    if (result != RESULT_OK || data == null) return;
    if (req == 73 && data.getData() != null) {
      Uri uri = data.getData();
      String id = prefs.getString("lrcSong", "");
      jobs.execute(
          () -> {
            try (InputStream in = getContentResolver().openInputStream(uri);
                ByteArrayOutputStream out = new ByteArrayOutputStream()) {
              byte[] b = new byte[4096];
              int n;
              while ((n = in.read(b)) > 0) {
                out.write(b, 0, n);
                if (out.size() > 512 * 1024) throw new IOException("歌词文件过大");
              }
              try (FileOutputStream f =
                  new FileOutputStream(new File(getFilesDir(), "lyrics-" + id + ".lrc"))) {
                out.writeTo(f);
              }
              ui.post(
                  () -> {
                    if (alive) {
                      if (service() != null
                          && service().current() != null
                          && service().current().id.equals(id)) {
                        service().lyricRaw =
                            new String(out.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
                        service().lyrics = Lyrics.parse(service().lyricRaw);
                      }
                      toast("歌词已导入");
                    }
                  });
            } catch (Exception e) {
              ui.post(
                  () -> {
                    if (alive) toast("歌词导入失败");
                  });
            }
          });
      return;
    }
    if (req != 71) return;
    ArrayList<Uri> uris = new ArrayList<>();
    if (data.getClipData() != null)
      for (int i = 0; i < Math.min(200, data.getClipData().getItemCount()); i++)
        uris.add(data.getClipData().getItemAt(i).getUri());
    else if (data.getData() != null) uris.add(data.getData());
    for (Uri u : uris)
      try {
        getContentResolver()
            .takePersistableUriPermission(
                u, data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION);
      } catch (Exception ignored) {
      }
    toast("正在导入 " + uris.size() + " 个文件…");
    jobs.execute(
        () -> {
          ArrayList<Song> added = new ArrayList<>();
          int failed = 0;
          for (Uri u : uris)
            try {
              added.add(readSong(u));
            } catch (Exception e) {
              failed++;
            }
          int bad = failed;
          ui.post(
              () -> {
                if (!alive) return;
                for (Song s : added) {
                  library.removeIf(x -> x.id.equals(s.id));
                  library.add(s);
                }
                Song.save(this, "library", library);
                toast("已导入 " + added.size() + " 首" + (bad > 0 ? "，" + bad + " 个文件无法读取" : ""));
                navigate("library");
              });
        });
  }

  private Song readSong(Uri uri) throws Exception {
    String name = "本地音乐";
    try (Cursor c =
        getContentResolver()
            .query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
      if (c != null && c.moveToFirst()) name = c.getString(0);
    }
    String id =
        "local-"
            + UUID.nameUUIDFromBytes(
                uri.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
    MediaMetadataRetriever r = new MediaMetadataRetriever();
    try {
      r.setDataSource(this, uri);
      String title = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE),
          artist = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST),
          duration = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
      String picture = "";
      byte[] embedded = r.getEmbeddedPicture();
      if (embedded == null)
        try (InputStream audio = getContentResolver().openInputStream(uri)) {
          embedded = EmbeddedArt.read(audio);
        } catch (Exception ignored) {
        }
      if (embedded != null) {
        Bitmap b = Artwork.decode(embedded, 512);
        if (b != null) {
          File f = new File(getFilesDir(), id + ".jpg");
          try (FileOutputStream out = new FileOutputStream(f)) {
            b.compress(Bitmap.CompressFormat.JPEG, 85, out);
          }
          picture = f.getAbsolutePath();
        }
      }
      return new Song(
          id,
          title == null ? name : title,
          artist == null ? "未知歌手" : artist,
          uri.toString(),
          picture,
          duration == null ? 0 : Long.parseLong(duration));
    } finally {
      r.release();
    }
  }

  public void onBackPressed() {
    if (mobile != null && webReady) {
      mobile.evaluateJavascript(
          "TideMobile.back()",
          result -> {
            if (!"true".equals(result)) finish();
          });
      return;
    }
    if (!page.equals("home")) navigate("home");
    else super.onBackPressed();
  }

  private void renderMobile() {
    if (mobile != null) {
      pushMobileState();
      if (!page.equals("home"))
        mobile.evaluateJavascript(
            "window.TideMobile&&TideMobile.go(" + JSONObject.quote(page) + ")", null);
      return;
    }
    mobile = new WebView(this);
    mobile.setBackgroundColor(Color.TRANSPARENT);
    WebSettings settings = mobile.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setSupportZoom(false);
    mobile.addJavascriptInterface(new MobileBridge(), "TideNative");
    mobile.setWebViewClient(
        new WebViewClient() {
          public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !"tide.local".equals(request.getUrl().getHost());
          }

          public WebResourceResponse shouldInterceptRequest(
              WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!"tide.local".equals(uri.getHost())) return null;
            try {
              String path = uri.getPath();
              if (path == null) throw new IOException();
              if (path.startsWith("/art/")) {
                String name = path.substring(5);
                if (!name.matches("[A-Za-z0-9_.-]+")) throw new IOException();
                File file = new File(getFilesDir(), name);
                if (!file.getCanonicalPath()
                    .startsWith(getFilesDir().getCanonicalPath() + File.separator))
                  throw new IOException();
                return new WebResourceResponse("image/jpeg", null, new FileInputStream(file));
              }
              if (path.equals("/")) path = "/index.html";
              if (path.contains("..")) throw new IOException();
              String mime =
                  path.endsWith(".js")
                      ? "application/javascript"
                      : path.endsWith(".css")
                          ? "text/css"
                          : path.endsWith(".png")
                              ? "image/png"
                              : path.endsWith(".ttf") ? "font/ttf" : "text/html";
              return new WebResourceResponse(mime, "UTF-8", getAssets().open("web" + path));
            } catch (Exception e) {
              return new WebResourceResponse(
                  "text/plain",
                  "UTF-8",
                  404,
                  "Not Found",
                  Collections.emptyMap(),
                  new ByteArrayInputStream(new byte[0]));
            }
          }
        });
    FrameLayout safe = new FrameLayout(this);
    safe.addView(mobile, new FrameLayout.LayoutParams(-1, -1));
    safe.setOnApplyWindowInsetsListener(
        (v, insets) -> {
          if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets padding =
                insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            safe.setPadding(padding.left, padding.top, padding.right, padding.bottom);
          } else
            safe.setPadding(
                insets.getSystemWindowInsetLeft(),
                insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(),
                insets.getSystemWindowInsetBottom());
          return insets;
        });
    getWindow().setStatusBarColor(0xff142536);
    getWindow().setNavigationBarColor(0xff142536);
    getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    setContentView(safe);
    safe.requestApplyInsets();
    mobile.loadUrl("https://tide.local/index.html");
  }

  public final class MobileBridge {
    @JavascriptInterface
    public void dispatch(String action, String payload) {
      if (payload == null || payload.length() > 8192 || action == null || action.length() > 40)
        return;
      ui.post(
          () -> {
            if (!alive) return;
            try {
              handleMobile(action, new JSONObject(payload));
            } catch (Exception e) {
              mobileMessage(
                  "toast", JSONObject.quote(e.getMessage() == null ? "操作失败" : e.getMessage()));
            }
          });
    }
  }

  private void mobileMessage(String method, String json) {
    if (mobile != null && alive)
      mobile.evaluateJavascript("window.TideMobile&&TideMobile." + method + "(" + json + ")", null);
  }

  private JSONObject webSong(Song song) throws JSONException {
    JSONObject j = song.json();
    String image = song.cover;
    if (image != null && !image.isEmpty() && !image.startsWith("https://")) {
      File f = new File(image);
      image = "https://tide.local/art/" + f.getName();
    }
    if (image != null && image.startsWith("http://")) image = "https://" + image.substring(7);
    j.put("cover", image == null ? "" : image);
    return j;
  }

  private JSONArray webSongs(List<Song> songs) throws JSONException {
    JSONArray rows = new JSONArray();
    for (Song s : songs) rows.put(webSong(s));
    return rows;
  }

  private JSONObject appearanceJson() throws JSONException {
    String shell = prefs.getString("shell", "lens"),
        background = prefs.getString("background", "paper");
    if (background.equals("flow")) background = "paper";
    if (background.equals("pixel")) background = "pixel-cover";
    JSONObject a =
        new JSONObject()
            .put("shell", shell)
            .put("lensMode", prefs.getBoolean("light", false) ? "light" : "dark")
            .put("latticeMode", prefs.getBoolean("light", false) ? "light" : "dark")
            .put("theme", "tide")
            .put("background", background)
            .put("performance", prefs.getString("performance", "balanced"))
            .put("chromeVisible", true)
            .put("stageLevel", 1)
            .put("motion", prefs.getBoolean("still", false) ? 0 : 1)
            .put("lattice", false)
            .put("preset", "flow")
            .put("fontPreset", "system")
            .put("fontFamily", "")
            .put("emblem", prefs.getString("emblem", "auto"));
    String colors = prefs.getString("colors", "");
    if (!colors.isEmpty()) {
      boolean light = prefs.getBoolean("light", false);
      a.put(
          "customPalette",
          new JSONObject()
              .put("enabled", true)
              .put("colors", new JSONArray(colors))
              .put(
                  "accent",
                  String.format(
                      Locale.ROOT, "#%06x", prefs.getInt("accent", 0xff68cde2) & 0xffffff))
              .put("text", light ? "#173247" : "#edf5fb")
              .put("muted", light ? "#516979" : "#b4c4d2")
              .put("points", light ? "#173247" : "#edf5fb")
              .put("panel", light ? "#e6eff3" : "#112638")
              .put("panelOpacity", .46));
    }
    return a;
  }

  private JSONObject playbackJson() throws JSONException {
    PlaybackService p = service();
    JSONObject j =
        new JSONObject()
            .put("playing", p != null && p.playing)
            .put("loading", p != null && p.loading)
            .put("error", p == null ? "" : p.error)
            .put("position", p == null ? 0 : p.position())
            .put("duration", p == null ? 0 : p.duration());
    JSONArray lyrics = new JSONArray();
    if (p != null)
      for (Lyrics.Line line : p.lyrics)
        lyrics.put(new JSONObject().put("time", line.time).put("text", line.text));
    return j.put("lyrics", lyrics);
  }

  private void pushPosition() {
    if (!webReady) return;
    try {
      mobileMessage("progress", playbackJson().toString());
    } catch (Exception ignored) {
    }
  }

  private void pushMobileState() {
    if (!webReady) return;
    try {
      PlaybackService p = service();
      List<Song> queue = p == null ? Song.read(this, "queue") : p.queue;
      String cookie = CookieManager.getInstance().getCookie("https://music.163.com");
      JSONObject j =
          playbackJson()
              .put("library", webSongs(library))
              .put("favorites", webSongs(favorites))
              .put("queue", webSongs(queue))
              .put("index", p == null ? prefs.getInt("queueIndex", 0) : p.index)
              .put("appearance", appearanceJson())
              .put("loggedIn", cookie != null && cookie.contains("MUSIC_U="))
              .put("nickname", prefs.getString("nickname", ""));
      mobileMessage("setState", j.toString());
    } catch (Exception e) {
      toast("界面同步失败");
    }
  }

  private List<Song> sourceRows(String source) {
    switch (source) {
      case "favorites":
        return favorites;
      case "search":
        return results;
      case "collection":
        return collectionRows;
      case "queue":
        return service() == null ? Song.read(this, "queue") : service().queue;
      default:
        return library;
    }
  }

  private Song findSong(String id) {
    for (List<Song> songs :
        Arrays.asList(
            library,
            favorites,
            results,
            collectionRows,
            service() == null ? Collections.<Song>emptyList() : service().queue))
      for (Song s : songs) if (s.id.equals(id)) return s;
    return null;
  }

  private void handleMobile(String action, JSONObject data) throws Exception {
    switch (action) {
      case "ready":
        webReady = true;
        pushMobileState();
        break;
      case "import":
        importMusic();
        break;
      case "play":
        {
          List<Song> songs = sourceRows(data.optString("source"));
          String id = data.optString("id");
          for (int i = 0; i < songs.size(); i++)
            if (songs.get(i).id.equals(id)) {
              PlaybackService.start(this, songs, i);
              break;
            }
          break;
        }
      case "toggle":
        toggle();
        break;
      case "next":
        if (service() != null) service().next(1);
        break;
      case "previous":
        if (service() != null) service().next(-1);
        break;
      case "seek":
        if (service() != null) service().seek(data.optLong("position"));
        break;
      case "repeat":
        {
          String mode = data.optString("mode");
          if (Arrays.asList("list", "one", "shuffle").contains(mode))
            prefs.edit().putString("repeat", mode).apply();
          break;
        }
      case "favorite":
        {
          Song song = findSong(data.optString("id"));
          if (song != null) {
            favorite(song);
            pushMobileState();
          }
          break;
        }
      case "song-options":
        {
          Song song = findSong(data.optString("id"));
          if (song != null) songOptions(song);
          break;
        }
      case "appearance":
        {
          android.content.SharedPreferences.Editor e = prefs.edit();
          for (String key : new String[] {"shell", "performance", "background", "emblem"})
            if (data.has(key)) {
              String value = data.optString(key);
              if (Arrays.asList(
                      "lens",
                      "lattice",
                      "smooth",
                      "balanced",
                      "vivid",
                      "solid",
                      "paper",
                      "pixel-cover",
                      "auto",
                      "liquid-metal")
                  .contains(value)) e.putString(key, value);
            }
          for (String key : new String[] {"lensMode", "latticeMode"})
            if (data.has(key)) e.putBoolean("light", data.optString(key).equals("light"));
          if (data.has("customPalette")) e.remove("colors");
          if (data.has("colors")) {
            JSONArray colors = data.getJSONArray("colors");
            if (colors.length() != 4) throw new IllegalArgumentException("需要四个配色");
            for (int i = 0; i < 4; i++)
              if (!colors.getString(i).matches("#[a-fA-F0-9]{6}"))
                throw new IllegalArgumentException("颜色格式错误");
            e.putString("colors", colors.toString());
          }
          e.apply();
          pushMobileState();
          break;
        }
      case "search":
      case "qr-key":
      case "qr-check":
      case "captcha":
      case "login":
      case "playlists":
      case "collection":
      case "daily":
        cloudAction(action, data);
        break;
      case "system-info":
        new AlertDialog.Builder(this)
            .setTitle("系统媒体与 ColorOS 流体云")
            .setMessage(
                "已接入系统媒体会话、歌曲封面、锁屏与耳机控制。你的一加 Ace 3 / ColorOS 16"
                    + " 已反馈能启动系统卡片；专用流体云定制能力尚未接入。具体显示由系统决定。此版本修正封面读取及媒体元数据传递。")
            .setPositiveButton("了解", null)
            .show();
        break;
    }
  }

  private void cloudAction(String action, JSONObject data) throws Exception {
    if (action.equals("captcha")) {
      if (SystemClock.elapsedRealtime() < smsAfter)
        throw new IllegalArgumentException("验证码发送过于频繁，请稍候");
      if (!data.optString("phone").matches("[0-9]{5,16}"))
        throw new IllegalArgumentException("请输入有效手机号");
      smsAfter = SystemClock.elapsedRealtime() + 60000;
    }
    if (action.equals("login")
        && (!data.optString("phone").matches("[0-9]{5,16}")
            || !data.optString("captcha").matches("[0-9]{4,8}")))
      throw new IllegalArgumentException("请填写手机号和验证码");
    jobs.execute(
        () -> {
          try {
            Cloud cloud = new Cloud(this);
            JSONObject response = new JSONObject().put("type", action);
            ArrayList<Song> songs = null;
            JSONObject result = null;
            switch (action) {
              case "search":
                {
                  String key = data.optString("key").trim();
                  if (key.isEmpty() || key.length() > 100) throw new IOException("请输入有效关键词");
                  int offset = Math.max(0, Math.min(1000, data.optInt("offset")));
                  songs = cloud.search(key, offset);
                  synchronized (results) {
                    if (offset == 0) results.clear();
                    results.addAll(songs);
                  }
                  response.put("items", webSongs(results));
                  break;
                }
              case "qr-key":
                result = cloud.qrKey();
                String key = result.optString("unikey");
                if (key.isEmpty()) throw new IOException(result.optString("message", "二维码生成失败"));
                response.put("key", key);
                break;
              case "qr-check":
                {
                  String qr = data.optString("key");
                  if (!qr.matches("[A-Za-z0-9_-]{8,200}")) throw new IOException("二维码无效");
                  result = cloud.qrCheck(qr);
                  response.put("code", result.optInt("code"));
                  break;
                }
              case "captcha":
                result = cloud.captcha(data.optString("phone"));
                response.put(
                    "message",
                    result.optInt("code") == 200
                        ? "验证码已发送"
                        : result.optString("message", "验证码发送失败"));
                break;
              case "login":
                result = cloud.login(data.optString("phone"), data.optString("captcha"));
                response
                    .put("code", result.optInt("code"))
                    .put(
                        "message",
                        result.optInt("code") == 200
                            ? "登录成功"
                            : result.optString("message", "登录失败，请尝试扫码授权"));
                if (result.optJSONObject("profile") != null)
                  prefs
                      .edit()
                      .putString("nickname", result.getJSONObject("profile").optString("nickname"))
                      .apply();
                break;
              case "playlists":
                result = cloud.account();
                JSONObject profile = result.optJSONObject("profile");
                if (profile == null) throw new IOException("请先扫码或验证码登录网易云");
                prefs.edit().putString("nickname", profile.optString("nickname")).apply();
                response.put(
                    "playlists",
                    cloud.playlists(profile.optLong("userId")).optJSONArray("playlist"));
                break;
              case "collection":
                songs = cloud.collection(data.optString("id"));
                collectionRows.clear();
                collectionRows.addAll(songs);
                response.put("items", webSongs(songs));
                break;
              case "daily":
                songs = cloud.daily();
                collectionRows.clear();
                collectionRows.addAll(songs);
                response.put("items", webSongs(songs));
                break;
            }
            JSONObject output = response;
            ui.post(
                () -> {
                  if (!alive) return;
                  mobileMessage("result", output.toString());
                  pushMobileState();
                });
          } catch (Exception failure) {
            ui.post(
                () -> {
                  if (!alive) return;
                  try {
                    mobileMessage(
                        "result",
                        new JSONObject()
                            .put("type", action)
                            .put("code", 0)
                            .put(
                                "message",
                                failure.getMessage() == null ? "网络请求失败" : failure.getMessage())
                            .toString());
                  } catch (Exception ignored) {
                  }
                });
          }
        });
  }

  private void repairArtwork() {
    jobs.execute(
        () -> {
          boolean changed = false;
          for (int i = 0; i < Math.min(200, library.size()); i++) {
            Song old = library.get(i);
            if (!old.cover.isEmpty() && new File(old.cover).isFile()) continue;
            try {
              Song updated = readSong(Uri.parse(old.uri));
              if (!updated.cover.isEmpty()) {
                old.cover = updated.cover;
                changed = true;
              }
            } catch (Exception ignored) {
            }
          }
          if (changed) {
            Song.save(this, "library", library);
            ui.post(
                () -> {
                  if (alive) {
                    if (PlaybackService.instance != null) PlaybackService.instance.refreshLibraryArtwork(library);
                    pushMobileState();
                  }
                });
          }
        });
  }
}
