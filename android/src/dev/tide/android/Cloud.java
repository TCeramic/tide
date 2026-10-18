package dev.tide.android;

import android.content.*;
import android.webkit.CookieManager;
import java.io.*;
import java.net.*;
import java.security.*;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;
import org.json.*;

/** EAPI encoding follows the pinned MIT NeteaseCloudMusicApi adapter used by Tide desktop. */
public class Cloud {
  private final Context c;

  public Cloud(Context c) {
    this.c = c.getApplicationContext();
  }

  public JSONObject call(String path, JSONObject data) throws Exception {
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
      saveCookies(conn);
      return new JSONObject(b.toString("UTF-8"));
    } finally {
      conn.disconnect();
    }
  }

  private void saveCookies(HttpURLConnection connection) {
    for (java.util.Map.Entry<String, java.util.List<String>> header :
        connection.getHeaderFields().entrySet())
      if (header.getKey() != null && header.getKey().equalsIgnoreCase("Set-Cookie"))
        for (String cookie : header.getValue())
          CookieManager.getInstance().setCookie("https://music.163.com", cookie);
    CookieManager.getInstance().flush();
  }

  public JSONObject weapi(String path, JSONObject data) throws Exception {
    String cookie = CookieManager.getInstance().getCookie("https://music.163.com");
    if (cookie == null) cookie = "";
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
    connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
    connection.setRequestProperty("Referer", "https://music.163.com/");
    connection.setRequestProperty(
        "User-Agent",
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36");
    if (!cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
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
    return call("/api/login/qrcode/unikey", new JSONObject().put("type", 3));
  }

  public JSONObject qrCheck(String key) throws Exception {
    return call("/api/login/qrcode/client/login", new JSONObject().put("type", 3).put("key", key));
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

  public ArrayList<Song> search(String key, int offset) throws Exception {
    JSONObject r =
        call(
            "/api/cloudsearch/pc",
            new JSONObject()
                .put("s", key)
                .put("type", 1)
                .put("limit", 20)
                .put("offset", offset)
                .put("total", true));
    if (r.optInt("code") != 200) throw new IOException(r.optString("message", "搜索暂不可用"));
    JSONArray rows =
        r.optJSONObject("result") == null ? null : r.getJSONObject("result").optJSONArray("songs");
    ArrayList<Song> out = new ArrayList<>();
    if (rows != null)
      for (int i = 0; i < rows.length(); i++) {
        JSONObject j = rows.getJSONObject(i), al = j.optJSONObject("al");
        JSONArray ar = j.optJSONArray("ar");
        StringBuilder artists = new StringBuilder();
        if (ar != null)
          for (int k = 0; k < ar.length(); k++) {
            if (k > 0) artists.append(" / ");
            artists.append(ar.getJSONObject(k).optString("name"));
          }
        out.add(
            new Song(
                j.optString("id"),
                j.optString("name"),
                artists.toString(),
                "",
                al == null ? "" : al.optString("picUrl"),
                j.optLong("dt")));
      }
    return out;
  }

  public String stream(Song s) throws Exception {
    if (!s.uri.isEmpty()) return s.uri;
    JSONObject r =
        call(
            "/api/song/enhance/player/url/v1",
            new JSONObject()
                .put("ids", "[" + s.id + "]")
                .put("level", "standard")
                .put("encodeType", "aac"));
    JSONArray a = r.optJSONArray("data");
    String url = a != null && a.length() > 0 ? a.getJSONObject(0).optString("url", "") : "";
    if (url.equals("null") || url.isEmpty()) throw new IOException("此歌曲暂无可播放音源，可能需要登录或版权权限");
    if (url.startsWith("http://")) url = "https://" + url.substring(7);
    if (!url.startsWith("https://")) throw new IOException("不支持的音频地址");
    return url;
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
