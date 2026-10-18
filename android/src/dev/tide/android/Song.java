package dev.tide.android;

import android.content.*;
import java.io.*;
import java.util.*;
import org.json.*;

public class Song {
  public String id, title, artist, uri, cover;
  public long duration;

  public Song(String id, String title, String artist, String uri, String cover, long duration) {
    this.id = id;
    this.title = title;
    this.artist = artist;
    this.uri = uri;
    this.cover = cover == null ? "" : cover.replaceFirst("^http://", "https://");
    this.duration = duration;
  }

  public JSONObject json() {
    JSONObject j = new JSONObject();
    try {
      j.put("id", id)
          .put("title", title)
          .put("artist", artist)
          .put("uri", uri)
          .put("cover", cover)
          .put("duration", duration);
    } catch (Exception ignored) {
    }
    return j;
  }

  public static Song from(JSONObject j) {
    return new Song(
        j.optString("id"),
        j.optString("title", "未命名"),
        j.optString("artist", "未知歌手"),
        j.optString("uri"),
        j.optString("cover"),
        j.optLong("duration"));
  }

  public static ArrayList<Song> read(Context c, String name) {
    ArrayList<Song> a = new ArrayList<>();
    try {
      File f = new File(c.getFilesDir(), name + ".json");
      if (!f.exists()) return a;
      ByteArrayOutputStream b = new ByteArrayOutputStream();
      try (InputStream in = new FileInputStream(f)) {
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
      }
      JSONArray rows = new JSONArray(b.toString("UTF-8"));
      for (int i = 0; i < rows.length(); i++) a.add(from(rows.getJSONObject(i)));
    } catch (Exception ignored) {
    }
    return a;
  }

  public static synchronized void save(Context c, String name, List<Song> a) {
    try {
      JSONArray j = new JSONArray();
      for (Song s : a) j.put(s.json());
      File f = new File(c.getFilesDir(), name + ".json"),
          tmp = new File(c.getFilesDir(), name + ".tmp");
      try (FileOutputStream out = new FileOutputStream(tmp)) {
        out.write(j.toString().getBytes("UTF-8"));
        out.getFD().sync();
      }
      if (!tmp.renameTo(f)) throw new IOException("write failed");
    } catch (Exception e) {
      throw new IllegalStateException("无法保存曲库", e);
    }
  }
}
