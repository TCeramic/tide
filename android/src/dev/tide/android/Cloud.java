package dev.tide.android;

import android.content.*;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import java.io.*;
import java.net.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.json.*;

/** EAPI encoding follows the pinned MIT NeteaseCloudMusicApi adapter used by Tide desktop. */
public class Cloud {
  public interface CookieCommitAction { void apply() throws Exception; }
  public interface CookieCommitGuard { boolean commit(CookieCommitAction action) throws Exception; }

  private final Context c;

  public Cloud(Context c) {
    this.c = c.getApplicationContext();
  }

  public JSONObject call(String path, JSONObject data) throws Exception {
    return call(path, data, null);
  }

  public JSONObject call(String path, JSONObject data, CookieCommitGuard cookieGuard) throws Exception {
    JSONObject h = new JSONObject();
    h.put("os", "android")
        .put("appver", "9.1.0")
        .put("osver", android.os.Build.VERSION.RELEASE)
        .put(
            "deviceId",
            android.provider.Settings.Secure.getString(
                c.getContentResolver(), android.provider.Settings.Secure.ANDROID_ID))
        .put("requestId", System.currentTimeMillis() + "_0001");
    String cookie = CookieManager.getInstance().getCookie("https://music.163.com");
    if (cookie == null) cookie = "";
    for (String part : cookie.split(";")) {
      String[] x = part.trim().split("=", 2);
      if (x.length == 2 && (x[0].equals("MUSIC_U") || x[0].equals("__csrf"))) h.put(x[0], x[1]);
    }
    data.put("header", h).put("e_r", false);
    String json = data.toString(),
        digest =
            hex(
                MessageDigest.getInstance("MD5")
                    .digest(("nobody" + path + "use" + json + "md5forencrypt").getBytes("UTF-8")));
    String payload = path + "-36cd479b6b5-" + json + "-36cd479b6b5-" + digest;
    Cipher aes = Cipher.getInstance("AES/ECB/PKCS5Padding");
    aes.init(Cipher.ENCRYPT_MODE, new SecretKeySpec("e82ckenh8dichen8".getBytes("UTF-8"), "AES"));
    byte[] body =
        ("params=" + hex(aes.doFinal(payload.getBytes("UTF-8"))).toUpperCase(Locale.ROOT))
            .getBytes("UTF-8");
    HttpURLConnection conn =
        (HttpURLConnection)
            new URL("https://interface.music.163.com/eapi/" + path.substring(5)).openConnection();
    conn.setConnectTimeout(18000);
    conn.setReadTimeout(18000);
    conn.setRequestMethod("POST");
    conn.setDoOutput(true);
    conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
    conn.setRequestProperty("User-Agent", "NeteaseMusic/9.1.0 Android");
    conn.setRequestProperty("Referer", "https://music.163.com/");
    if (!cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
    try {
      conn.getOutputStream().write(body);
      if (conn.getResponseCode() != 200) throw new IOException("网络请求失败 " + conn.getResponseCode());
      ByteArrayOutputStream b = new ByteArrayOutputStream();
      try (InputStream in = conn.getInputStream()) {
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
          b.write(buf, 0, n);
          if (b.size() > 4 * 1024 * 1024) throw new IOException("响应过大");
        }
      }
      if (!saveCookies(conn, cookieGuard)) throw new IOException("二维码请求已失效");
      return new JSONObject(b.toString("UTF-8"));
    } finally {
      conn.disconnect();
    }
  }

  private boolean saveCookies(HttpURLConnection connection) throws Exception {
    return saveCookies(connection, null);
  }

  private JSONObject callQr(String path, JSONObject data, CookieCommitGuard cookieGuard) throws Exception {
    String rawCookie = CookieManager.getInstance().getCookie("https://music.163.com");
    LinkedHashMap<String, String> cookies = AuthRequestEnvelope.parseCookies(rawCookie);
    long now = System.currentTimeMillis();
    Map<String, String> metadata =
        AuthRequestEnvelope.qrMetadata(cookies, qrDeviceId(), now, new SecureRandom().nextInt(1000));
    data.put("header", new JSONObject(metadata)).put("e_r", false);
    AuthRequestEnvelope.Request envelope =
        AuthRequestEnvelope.qrEapi(
            "https://interface.music.163.com", path, data.toString(), metadata);
    HttpURLConnection conn =
        (HttpURLConnection) new URL(envelope.url).openConnection();
    try {
      envelope.writeTo(conn);
      if (conn.getResponseCode() != 200)
        throw new IOException("二维码请求失败 " + conn.getResponseCode());
      ByteArrayOutputStream bytes = new ByteArrayOutputStream();
      try (InputStream in = conn.getInputStream()) {
        byte[] buffer = new byte[8192];
        int count;
        while ((count = in.read(buffer)) > 0) {
          bytes.write(buffer, 0, count);
          if (bytes.size() > 4 * 1024 * 1024) throw new IOException("响应过大");
        }
      }
      if (!saveCookies(conn, cookieGuard)) throw new IOException("二维码请求已失效");
      return new JSONObject(bytes.toString("UTF-8"));
    } finally {
      conn.disconnect();
    }
  }

  private String qrDeviceId() {
    android.content.SharedPreferences preferences =
        c.getSharedPreferences("cloud", Context.MODE_PRIVATE);
    String deviceId = preferences.getString("qrDeviceId", "");
    if (!deviceId.isEmpty()) return deviceId;
    final char[] alphabet = "0123456789ABCDEF".toCharArray();
    SecureRandom random = new SecureRandom();
    StringBuilder generated = new StringBuilder(52);
    for (int i = 0; i < 52; i++) generated.append(alphabet[random.nextInt(alphabet.length)]);
    deviceId = generated.toString();
    preferences.edit().putString("qrDeviceId", deviceId).apply();
    return deviceId;
  }

  private boolean saveCookies(HttpURLConnection connection, CookieCommitGuard cookieGuard) throws Exception {
    ArrayList<String> values = new ArrayList<>();
    for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet())
      if (header.getKey() != null && header.getKey().equalsIgnoreCase("Set-Cookie"))
        values.addAll(header.getValue());
    Handler main = new Handler(Looper.getMainLooper());
    CountDownLatch dispatched = new CountDownLatch(1);
    CountDownLatch applied = new CountDownLatch(values.size());
    AtomicBoolean accepted = new AtomicBoolean(true);
    AtomicBoolean current = new AtomicBoolean(cookieGuard == null);
    AtomicReference<Exception> failure = new AtomicReference<>();
    Runnable dispatch = () -> {
      try {
        CookieManager manager = CookieManager.getInstance();
        CookieCommitAction enqueue = () -> {
          current.set(true);
          for (String cookie : values) manager.setCookie("https://music.163.com", cookie,
              result -> {
                if (!Boolean.TRUE.equals(result)) accepted.set(false);
                applied.countDown();
              });
        };
        if (cookieGuard == null) enqueue.apply();
        else current.set(cookieGuard.commit(enqueue));
      } catch (Exception e) {
        failure.set(e);
        while (applied.getCount() > 0) applied.countDown();
      } finally {
        dispatched.countDown();
      }
    };
    if (Looper.myLooper() == Looper.getMainLooper()) dispatch.run();
    else if (!main.post(dispatch)) throw new IOException("登录凭据写入失败");
    if (!dispatched.await(4, TimeUnit.SECONDS)) throw new IOException("登录凭据写入超时");
    if (failure.get() != null) throw failure.get();
    if (!current.get()) return false;
    if (!applied.await(4, TimeUnit.SECONDS)) throw new IOException("登录凭据写入超时");
    if (!accepted.get()) throw new IOException("登录凭据未被系统保存");
    CookieManager.getInstance().flush();
    return true;
  }

  public JSONObject weapi(String path, JSONObject data) throws Exception {
    return weapi(path, data, AuthRequestEnvelope.weapiPolicy(path));
  }

  private JSONObject weapi(String path, JSONObject data, AuthRequestEnvelope.WeapiPolicy policy) throws Exception {
    String cookie = CookieManager.getInstance().getCookie("https://music.163.com");
    if (cookie == null) cookie = "";
    if (policy.upstreamCookieDefaults) cookie = upstreamWeapiCookie(cookie, path);
    String csrf = "";
    for (String part : cookie.split(";"))
      if (part.trim().startsWith("__csrf=")) csrf = part.trim().substring(7);
    data.put("csrf_token", csrf);
    byte[] random = new byte[16];
    new SecureRandom().nextBytes(random);
    String alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    StringBuilder secret = new StringBuilder();
    for (byte value : random) secret.append(alphabet.charAt((value & 255) % 62));
    String first = cbc(data.toString(), "0CoJUm6Qyw8W8jud"), params = cbc(first, secret.toString());
    String key =
        "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB";
    java.security.PublicKey publicKey =
        KeyFactory.getInstance("RSA")
            .generatePublic(
                new java.security.spec.X509EncodedKeySpec(
                    android.util.Base64.decode(key, android.util.Base64.DEFAULT)));
    Cipher rsa = Cipher.getInstance("RSA/ECB/NoPadding");
    rsa.init(Cipher.ENCRYPT_MODE, publicKey);
    String encrypted = hex(rsa.doFinal(secret.reverse().toString().getBytes("UTF-8")));
    byte[] body =
        ("params=" + URLEncoder.encode(params, "UTF-8") + "&encSecKey=" + encrypted)
            .getBytes("UTF-8");
    HttpURLConnection connection =
        (HttpURLConnection)
            new URL("https://music.163.com/weapi/" + path.substring(5)).openConnection();
    connection.setConnectTimeout(18000);
    connection.setReadTimeout(18000);
    connection.setRequestMethod("POST");
    connection.setDoOutput(true);
    for (Map.Entry<String, String> header : policy.headers(cookie).entrySet())
      connection.setRequestProperty(header.getKey(), header.getValue());
    try {
      connection.getOutputStream().write(body);
      if (connection.getResponseCode() != 200)
        throw new IOException("登录请求失败 " + connection.getResponseCode());
      try (InputStream in = connection.getInputStream();
          ByteArrayOutputStream out = new ByteArrayOutputStream()) {
        byte[] buffer = new byte[8192];
        int n;
        while ((n = in.read(buffer)) > 0) {
          out.write(buffer, 0, n);
          if (out.size() > 4 * 1024 * 1024) throw new IOException("响应过大");
        }
        saveCookies(connection);
        return new JSONObject(out.toString("UTF-8"));
      }
    } finally {
      connection.disconnect();
    }
  }

  private String upstreamWeapiCookie(String raw, String path) throws Exception {
    LinkedHashMap<String, String> values = new LinkedHashMap<>();
    for (String part : raw.split(";")) {
      String[] pair = part.trim().split("=", 2);
      if (pair.length == 2 && !pair[0].isEmpty()) values.put(pair[0], pair[1]);
    }
    String nuid = values.getOrDefault("_ntes_nuid", randomHex(16));
    values.put("__remember_me", "true");
    values.put("ntes_kaola_ad", "1");
    values.put("_ntes_nuid", nuid);
    values.putIfAbsent("_ntes_nnid", nuid + "," + System.currentTimeMillis());
    values.putIfAbsent("WNMCID", randomLower(6) + "." + System.currentTimeMillis() + ".01.0");
    values.putIfAbsent("WEVNSM", "1.0.0");
    String os = values.getOrDefault("os", "pc");
    boolean isAndroid = os.equals("android");
    values.putIfAbsent("os", os);
    values.putIfAbsent("appver", isAndroid ? "8.20.20.231215173437" : "3.1.17.204416");
    values.putIfAbsent("osver", isAndroid ? android.os.Build.VERSION.RELEASE : "Microsoft-Windows-10-Professional-build-19045-64bit");
    values.putIfAbsent("channel", isAndroid ? "xiaomi" : "netease");
    values.putIfAbsent("deviceId", isAndroid ? android.provider.Settings.Secure.getString(c.getContentResolver(), android.provider.Settings.Secure.ANDROID_ID) : "");
    if (!path.contains("login")) values.putIfAbsent("NMTID", randomHex(8));
    StringBuilder header = new StringBuilder();
    for (Map.Entry<String, String> entry : values.entrySet()) {
      if (header.length() > 0) header.append("; ");
      header.append(android.net.Uri.encode(entry.getKey())).append('=')
          .append(android.net.Uri.encode(entry.getValue()));
    }
    return header.toString();
  }

  private static String randomHex(int bytes) {
    byte[] random = new byte[bytes];
    new SecureRandom().nextBytes(random);
    return hex(random).toLowerCase(Locale.ROOT);
  }

  private static String randomLower(int length) {
    String alphabet = "abcdefghijklmnopqrstuvwxyz";
    SecureRandom random = new SecureRandom();
    StringBuilder value = new StringBuilder(length);
    for (int i = 0; i < length; i++) value.append(alphabet.charAt(random.nextInt(alphabet.length())));
    return value.toString();
  }

  private String cbc(String text, String key) throws Exception {
    Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
    cipher.init(
        Cipher.ENCRYPT_MODE,
        new SecretKeySpec(key.getBytes("UTF-8"), "AES"),
        new IvParameterSpec("0102030405060708".getBytes("UTF-8")));
    return android.util.Base64.encodeToString(
        cipher.doFinal(text.getBytes("UTF-8")), android.util.Base64.NO_WRAP);
  }

  public JSONObject qrKey() throws Exception {
    return callQr("/api/login/qrcode/unikey", new JSONObject().put("type", 3), null);
  }

  public JSONObject qrKey(CookieCommitGuard cookieGuard) throws Exception {
    return callQr("/api/login/qrcode/unikey", new JSONObject().put("type", 3), cookieGuard);
  }

  public JSONObject qrCheck(String key) throws Exception {
    return callQr("/api/login/qrcode/client/login", new JSONObject().put("type", 3).put("key", key), null);
  }

  public JSONObject qrCheck(String key, CookieCommitGuard cookieGuard) throws Exception {
    return callQr("/api/login/qrcode/client/login", new JSONObject().put("type", 3).put("key", key), cookieGuard);
  }

  public JSONObject captcha(String phone) throws Exception {
    return weapi(
        "/api/sms/captcha/sent",
        new JSONObject()
            .put("ctcode", "86")
            .put("secrete", "music_middleuser_pclogin")
            .put("cellphone", phone));
  }

  public JSONObject login(String phone, String captcha) throws Exception {
    return weapi(
        "/api/w/login/cellphone",
        new JSONObject()
            .put("type", "1")
            .put("https", "true")
            .put("phone", phone)
            .put("countrycode", "86")
            .put("captcha", captcha)
            .put("remember", "true"));
  }

  public JSONObject account() throws Exception {
    return call("/api/nuser/account/get", new JSONObject());
  }

  public JSONObject playlists(long uid) throws Exception {
    return call(
        "/api/user/playlist", new JSONObject().put("uid", uid).put("limit", 100).put("offset", 0));
  }

  public ArrayList<Song> collection(String id) throws Exception {
    JSONObject response =
        call("/api/v6/playlist/detail", new JSONObject().put("id", id).put("n", 500).put("s", 0));
    JSONObject playlist = response.optJSONObject("playlist");
    JSONArray tracks = playlist == null ? null : playlist.optJSONArray("tracks");
    if (tracks == null) throw new IOException(response.optString("message", "歌单暂不可用"));
    return songs(tracks);
  }

  public ArrayList<Song> daily() throws Exception {
    JSONObject response = call("/api/v3/discovery/recommend/songs", new JSONObject());
    JSONObject data = response.optJSONObject("data");
    JSONArray tracks = data == null ? null : data.optJSONArray("dailySongs");
    if (tracks == null) throw new IOException(response.optString("message", "请先登录网易云"));
    return songs(tracks);
  }

  private ArrayList<Song> songs(JSONArray rows) throws Exception {
    ArrayList<Song> result = new ArrayList<>();
    for (int i = 0; i < rows.length(); i++) {
      JSONObject j = rows.getJSONObject(i), album = j.optJSONObject("al");
      if (album == null) album = j.optJSONObject("album");
      JSONArray artists = j.optJSONArray("ar");
      if (artists == null) artists = j.optJSONArray("artists");
      StringBuilder names = new StringBuilder();
      if (artists != null)
        for (int k = 0; k < artists.length(); k++) {
          if (k > 0) names.append(" / ");
          names.append(artists.getJSONObject(k).optString("name"));
        }
      result.add(
          new Song(
              j.optString("id"),
              j.optString("name"),
              names.toString(),
              "",
              album == null ? "" : album.optString("picUrl"),
              j.optLong("dt", j.optLong("duration"))));
    }
    return result;
  }

  public JSONObject searchResult(String key, int offset, String kind) throws Exception {
    int type=kind.equals("artists")?100:kind.equals("albums")?10:kind.equals("playlists")?1000:1;
    JSONObject response=call("/api/cloudsearch/pc",new JSONObject().put("s",key).put("type",type).put("limit",20).put("offset",offset).put("total",true));
    if(response.optInt("code")!=200)throw new IOException(response.optString("message","搜索暂不可用"));
    JSONObject result=response.optJSONObject("result");return result==null?new JSONObject():result;
  }
  public ArrayList<Song> search(String key,int offset) throws Exception {JSONArray rows=searchResult(key,offset,"songs").optJSONArray("songs");return rows==null?new ArrayList<>():songs(rows);}
  public ArrayList<Song> similar(String id) throws Exception {
    JSONObject response=weapi("/api/v1/discovery/simiSong",new JSONObject().put("songid",id).put("limit",30).put("offset",0));
    JSONArray rows=response.optJSONArray("songs");if(rows==null)throw new IOException(response.optString("message","暂无相似歌曲"));return songs(rows);
  }
  public JSONArray recommendedPlaylists() throws Exception {JSONObject r=weapi("/api/v1/discovery/recommend/resource",new JSONObject());if(r.optInt("code")!=200)throw new IOException(r.optString("message","推荐歌单暂不可用"));return r.optJSONArray("recommend");}
  /** Desktop-compatible pool: /personalized/playlist answers with or without a login. */
  public JSONArray personalizedPlaylists(int limit) throws Exception {
    try {
      JSONObject r = weapi("/api/personalized/playlist", new JSONObject().put("limit", Math.max(1, Math.min(50, limit))));
      JSONArray rows = r.optJSONArray("result");
      if (rows != null && rows.length() > 0) return rows;
    } catch (Exception ignored) {
      // Fall through to the generic recommendation feed.
    }
    return recommendedPlaylists();
  }
  public void createPlaylist(String name,boolean privacy) throws Exception {
    if(name.trim().isEmpty()||name.length()>40)throw new IOException("请输入 1–40 字的歌单名");
    JSONObject r=weapi("/api/playlist/create",new JSONObject().put("name",name.trim()).put("privacy",privacy?"10":"0").put("type","NORMAL"));
    if(r.optInt("code")!=200)throw new IOException(r.optString("message","创建歌单失败"));
  }
  public ArrayList<Song> album(String id) throws Exception {JSONObject r=weapi("/api/v1/album/"+id,new JSONObject());JSONArray a=r.optJSONArray("songs");if(a==null)throw new IOException("专辑暂不可用");return songs(a);}
  public ArrayList<Song> artist(String id) throws Exception {JSONObject r=weapi("/api/v1/artist/"+id,new JSONObject());JSONArray a=r.optJSONArray("hotSongs");if(a==null)throw new IOException("歌手歌曲暂不可用");return songs(a);}

  private static final java.util.List<String> STREAM_LEVELS =
      java.util.Arrays.asList("standard", "exhigh", "lossless", "hires");

  public String stream(Song s) throws Exception {
    return stream(s, "standard");
  }

  /** Requests the preferred level first, then every lower step, ending at standard. */
  public String stream(Song s, String level) throws Exception {
    if (!s.uri.isEmpty()) return s.uri;
    int start = STREAM_LEVELS.indexOf(level);
    if (start < 0) start = 0;
    String lastError = "此歌曲暂无可播放音源，可能需要登录或版权权限";
    for (int i = start; i >= 0; i--) {
      try {
        String url = requestStream(s, STREAM_LEVELS.get(i));
        if (!url.isEmpty()) return url;
      } catch (IOException e) {
        lastError = e.getMessage();
      }
    }
    throw new IOException(lastError);
  }

  private String requestStream(Song s, String level) throws Exception {
    JSONObject r =
        call(
            "/api/song/enhance/player/url/v1",
            new JSONObject()
                .put("ids", "[" + s.id + "]")
                .put("level", level)
                .put("encodeType", "aac"));
    JSONArray a = r.optJSONArray("data");
    String url = a != null && a.length() > 0 ? a.getJSONObject(0).optString("url", "") : "";
    if (url.equals("null") || url.isEmpty()) return "";
    if (url.startsWith("http://")) url = "https://" + url.substring(7);
    if (!url.startsWith("https://")) return "";
    return url;
  }

  public JSONObject lyricBundle(Song s) throws Exception {
    return call("/api/song/lyric",new JSONObject().put("id",s.id).put("lv",-1).put("tv",-1).put("rv",-1));
  }

  public java.util.Set<String> likedIds() throws Exception {
    JSONObject profile=account().optJSONObject("profile");
    if(profile==null) throw new IOException("请先登录网易云");
    JSONObject response=call("/api/song/like/get",new JSONObject().put("uid",profile.optLong("userId")));
    if(response.optInt("code")!=200 || !response.has("ids")) throw new IOException("网易云喜欢状态读取失败");
    java.util.Set<String> ids=new java.util.HashSet<>(); JSONArray rows=response.getJSONArray("ids");
    for(int i=0;i<rows.length();i++)ids.add(rows.getString(i));
    return ids;
  }

  public ArrayList<Song> likedSongs(int offset) throws Exception {
    ArrayList<String> ids=new ArrayList<>();JSONArray all=Favorites.ids();for(int i=0;i<all.length();i++)ids.add(all.getString(i));Collections.sort(ids);
    JSONArray wanted=new JSONArray();for(int i=Math.max(0,offset);i<Math.min(ids.size(),offset+100);i++)wanted.put(new JSONObject().put("id",ids.get(i)));
    if(wanted.length()==0)return new ArrayList<>();JSONObject response=weapi("/api/v3/song/detail",new JSONObject().put("c",wanted.toString()));
    if(response.optInt("code")!=200)throw new IOException("喜欢的音乐详情读取失败");return songs(response.getJSONArray("songs"));
  }

  public void like(String id,boolean liked) throws Exception {
    JSONObject response=weapi("/api/radio/like",new JSONObject().put("alg","itembased").put("trackId",id).put("like",liked).put("time","3"));
    if(response.optInt("code")!=200)throw new IOException(response.optString("message","网易云喜欢操作失败")+"（"+response.optInt("code")+"）");
  }

  public void collect(String playlist,String id) throws Exception {
    JSONObject response=weapi("/api/playlist/manipulate/tracks",new JSONObject().put("op","add").put("pid",playlist).put("trackIds",new JSONArray().put(id).toString()).put("imme",true));
    if(response.optInt("code")!=200)throw new IOException(response.optString("message","收藏到歌单失败"));
  }

  public String lyrics(Song s) throws Exception {
    JSONObject r =
        call(
            "/api/song/lyric",
            new JSONObject().put("id", s.id).put("lv", -1).put("tv", -1).put("rv", -1));
    JSONObject j = r.optJSONObject("lrc");
    return j == null ? "" : j.optString("lyric");
  }

  private static String hex(byte[] b) {
    StringBuilder s = new StringBuilder();
    for (byte x : b) s.append(String.format(Locale.ROOT, "%02x", x & 255));
    return s.toString();
  }
}
