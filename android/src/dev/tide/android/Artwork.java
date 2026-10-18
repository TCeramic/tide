package dev.tide.android;

import android.content.Context;
import android.graphics.*;
import java.io.*;
import java.net.*;

public final class Artwork {
  public static Bitmap load(Context c, String source, int size) {
    if (source == null || source.isEmpty()) return null;
    try {
      byte[] bytes;
      if (source.startsWith("https://")) {
        URL u = new URL(source);
        String host = u.getHost().toLowerCase(java.util.Locale.ROOT);
        if (!(host.endsWith(".music.126.net") || host.endsWith(".music.163.com"))) return null;
        HttpURLConnection con = (HttpURLConnection) u.openConnection();
        con.setConnectTimeout(9000);
        con.setReadTimeout(9000);
        try (InputStream in = con.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream()) {
          byte[] buf = new byte[8192];
          int n;
          while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
            if (out.size() > 8 * 1024 * 1024) return null;
          }
          bytes = out.toByteArray();
        } finally {
          con.disconnect();
        }
      } else {
        File file = new File(source);
        if (!file.getCanonicalPath()
            .startsWith(c.getFilesDir().getCanonicalPath() + File.separator)) return null;
        bytes = java.nio.file.Files.readAllBytes(file.toPath());
      }
      return decode(bytes, size);
    } catch (Exception e) {
      return null;
    }
  }

  public static Bitmap decode(byte[] b, int size) {
    BitmapFactory.Options o = new BitmapFactory.Options();
    o.inJustDecodeBounds = true;
    BitmapFactory.decodeByteArray(b, 0, b.length, o);
    o.inSampleSize = 1;
    while (o.outWidth / o.inSampleSize > size * 2 || o.outHeight / o.inSampleSize > size * 2)
      o.inSampleSize *= 2;
    o.inJustDecodeBounds = false;
    Bitmap decoded = BitmapFactory.decodeByteArray(b, 0, b.length, o);
    if (decoded == null) return null;
    int edge = Math.max(decoded.getWidth(), decoded.getHeight());
    if (edge > size) {
      Bitmap scaled =
          Bitmap.createScaledBitmap(
              decoded,
              Math.max(1, decoded.getWidth() * size / edge),
              Math.max(1, decoded.getHeight() * size / edge),
              true);
      if (scaled != decoded) decoded.recycle();
      return scaled;
    }
    return decoded;
  }
}
