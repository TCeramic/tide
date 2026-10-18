package dev.tide.android;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;

/** Builds the pinned upstream request profiles used by Android authentication. */
final class AuthRequestEnvelope {
  static final String DEFAULT_WEAPI_UA =
      "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
  static final String UPSTREAM_WEAPI_UA =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
  static final String QR_EAPI_UA = "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)";

  private static final String EAPI_KEY = "e82ckenh8dichen8";
  private static final String MARKER = "-36cd479b6b5-";

  private AuthRequestEnvelope() {}

  static final class WeapiPolicy {
    final String userAgent;
    final boolean upstreamCookieDefaults;

    WeapiPolicy(String userAgent, boolean upstreamCookieDefaults) {
      this.userAgent = userAgent;
      this.upstreamCookieDefaults = upstreamCookieDefaults;
    }

    Map<String, String> headers(String cookie) {
      LinkedHashMap<String, String> result = new LinkedHashMap<>();
      result.put("Content-Type", "application/x-www-form-urlencoded");
      result.put("Referer", "https://music.163.com/");
      result.put("User-Agent", userAgent);
      if (cookie != null && !cookie.isEmpty()) result.put("Cookie", cookie);
      return result;
    }
  }

  static WeapiPolicy weapiPolicy(String path) {
    if ("/api/radio/like".equals(path))
      return new WeapiPolicy(UPSTREAM_WEAPI_UA, true);
    return new WeapiPolicy(DEFAULT_WEAPI_UA, false);
  }

  static LinkedHashMap<String, String> parseCookies(String raw) {
    LinkedHashMap<String, String> result = new LinkedHashMap<>();
    if (raw == null || raw.isEmpty()) return result;
    for (String part : raw.split(";")) {
      String[] pair = part.trim().split("=", 2);
      if (pair.length == 2 && !pair[0].isEmpty()) result.put(pair[0], pair[1]);
    }
    return result;
  }

  static LinkedHashMap<String, String> qrMetadata(
      Map<String, String> cookies, String deviceId, long nowMillis, int requestSuffix) {
    String os = value(cookies, "os", "pc");
    String defaultAppver = "3.1.17.204416";
    String defaultOsver = "Microsoft-Windows-10-Professional-build-19045-64bit";
    String defaultChannel = "netease";
    if ("android".equals(os)) {
      defaultAppver = "8.20.20.231215173437";
      defaultOsver = "14";
      defaultChannel = "xiaomi";
    } else if ("iphone".equals(os)) {
      defaultAppver = "9.0.90";
      defaultOsver = "16.2";
      defaultChannel = "distribution";
    } else if ("linux".equals(os)) {
      defaultAppver = "1.2.1.0428";
      defaultOsver = "Deepin 20.9";
    }

    LinkedHashMap<String, String> header = new LinkedHashMap<>();
    header.put("osver", value(cookies, "osver", defaultOsver));
    header.put("deviceId", value(cookies, "deviceId", deviceId));
    header.put("os", os);
    header.put("appver", value(cookies, "appver", defaultAppver));
    header.put("versioncode", value(cookies, "versioncode", "140"));
    header.put("mobilename", value(cookies, "mobilename", ""));
    header.put("buildver", value(cookies, "buildver", Long.toString(nowMillis / 1000L)));
    header.put("resolution", value(cookies, "resolution", "1920x1080"));
    header.put("__csrf", value(cookies, "__csrf", ""));
    header.put("channel", value(cookies, "channel", defaultChannel));
    int normalizedSuffix = Math.floorMod(requestSuffix, 1000);
    header.put(
        "requestId",
        Long.toString(nowMillis) + "_" + String.format(Locale.ROOT, "%04d", normalizedSuffix));
    if (cookies.containsKey("MUSIC_U")) header.put("MUSIC_U", cookies.get("MUSIC_U"));
    if (cookies.containsKey("MUSIC_A")) header.put("MUSIC_A", cookies.get("MUSIC_A"));
    return header;
  }

  static final class Request {
    final String url;
    final LinkedHashMap<String, String> headers;
    final byte[] body;

    Request(String url, LinkedHashMap<String, String> headers, byte[] body) {
      this.url = url;
      this.headers = headers;
      this.body = body;
    }

    void writeTo(HttpURLConnection connection) throws IOException {
      connection.setConnectTimeout(18000);
      connection.setReadTimeout(18000);
      connection.setRequestMethod("POST");
      connection.setDoOutput(true);
      for (Map.Entry<String, String> header : headers.entrySet())
        connection.setRequestProperty(header.getKey(), header.getValue());
      try (java.io.OutputStream out = connection.getOutputStream()) {
        out.write(body);
      }
    }
  }

  static Request qrEapi(
      String baseUrl, String path, String json, Map<String, String> metadata) throws Exception {
    if (path == null || !path.startsWith("/api/"))
      throw new IllegalArgumentException("QR endpoint must use the /api/ path");
    String digest =
        hex(
            MessageDigest.getInstance("MD5")
                .digest(("nobody" + path + "use" + json + "md5forencrypt").getBytes("UTF-8")));
    String payload = path + MARKER + json + MARKER + digest;
    Cipher aes = Cipher.getInstance("AES/ECB/PKCS5Padding");
    aes.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(EAPI_KEY.getBytes("UTF-8"), "AES"));
    byte[] body =
        ("params=" + hex(aes.doFinal(payload.getBytes("UTF-8"))).toUpperCase(Locale.ROOT))
            .getBytes("UTF-8");

    LinkedHashMap<String, String> headers = new LinkedHashMap<>();
    headers.put("Content-Type", "application/x-www-form-urlencoded");
    headers.put("User-Agent", QR_EAPI_UA);
    headers.put("Cookie", headerCookie(metadata));
    String endpoint = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    endpoint += "/eapi/" + path.substring(5);
    return new Request(endpoint, headers, body);
  }

  static String headerCookie(Map<String, String> metadata) {
    StringBuilder result = new StringBuilder();
    for (Map.Entry<String, String> entry : metadata.entrySet()) {
      if (result.length() > 0) result.append("; ");
      result.append(encodeURIComponent(entry.getKey())).append('=')
          .append(encodeURIComponent(entry.getValue()));
    }
    return result.toString();
  }

  private static String value(Map<String, String> values, String key, String fallback) {
    String current = values.get(key);
    return current == null || current.isEmpty() ? fallback : current;
  }

  private static String encodeURIComponent(String value) {
    byte[] bytes = value.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    StringBuilder encoded = new StringBuilder(bytes.length * 3);
    final char[] hex = "0123456789ABCDEF".toCharArray();
    for (byte valueByte : bytes) {
      int b = valueByte & 0xff;
      if ((b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
          || (b >= '0' && b <= '9') || "-_.!~*'()".indexOf(b) >= 0) {
        encoded.append((char) b);
      } else {
        encoded.append('%').append(hex[b >>> 4]).append(hex[b & 15]);
      }
    }
    return encoded.toString();
  }

  private static String hex(byte[] bytes) {
    StringBuilder result = new StringBuilder(bytes.length * 2);
    for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
    return result.toString();
  }
}
