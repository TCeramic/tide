package dev.tide.android;

import android.content.Context;
import android.webkit.CookieManager;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;

/** Cloud ids are authoritative only after a successful account lookup. Local tracks stay local. */
public final class Favorites {
  private static final Object CACHE_LOCK = new Object();
  // Serialize remote refresh/toggle operations without blocking UI reads of the cached ids.
  private static final Object OPERATION_LOCK = new Object();
  private static final Set<String> cloudIds = new HashSet<>();
  public static volatile boolean known = false;
  private static String accountSession = "";
  private static long refreshedAt;
  private static long sessionEpoch;
  private static long mutationRevision;

  private Favorites() {}

  public static String session() {
    String cookie = CookieManager.getInstance().getCookie("https://music.163.com");
    if (cookie != null)
      for (String part : cookie.split(";"))
        if (part.trim().startsWith("MUSIC_U=")) return part.trim();
    return "";
  }

  private static void syncSessionLocked(String value) {
    if (!value.equals(accountSession)) {
      accountSession = value;
      cloudIds.clear();
      known = false;
      refreshedAt = 0;
      sessionEpoch++;
      mutationRevision++;
    }
  }

  public static void syncSession() {
    String value = session();
    synchronized (CACHE_LOCK) {
      syncSessionLocked(value);
    }
  }

  public static boolean stale() {
    String value = session();
    synchronized (CACHE_LOCK) {
      syncSessionLocked(value);
      return !known || android.os.SystemClock.elapsedRealtime() - refreshedAt > 30000;
    }
  }

  public static void clear() {
    String value = session();
    synchronized (CACHE_LOCK) {
      syncSessionLocked(value);
      cloudIds.clear();
      known = false;
      refreshedAt = 0;
      // Invalidate any network result that began before this explicit reset.
      sessionEpoch++;
      mutationRevision++;
    }
  }

  public static void refresh(Context c) throws Exception {
    synchronized (OPERATION_LOCK) {
      refreshLocked(c);
    }
  }

  private static void refreshLocked(Context c) throws Exception {
    String started = session();
    long startedEpoch;
    long startedRevision;
    synchronized (CACHE_LOCK) {
      syncSessionLocked(started);
      startedEpoch = sessionEpoch;
      startedRevision = mutationRevision;
    }

    Set<String> ids = new Cloud(c).likedIds();
    String finished = session();
    synchronized (CACHE_LOCK) {
      syncSessionLocked(finished);
      if (!started.equals(finished))
        throw new IOException("账号已切换，请重新同步喜欢状态");
      if (startedEpoch != sessionEpoch || startedRevision != mutationRevision)
        throw new IOException("喜欢状态已变化，请重新同步");
      cloudIds.clear();
      cloudIds.addAll(ids);
      known = true;
      refreshedAt = android.os.SystemClock.elapsedRealtime();
      mutationRevision++;
    }
  }

  public static JSONArray ids() {
    synchronized (CACHE_LOCK) {
      return new JSONArray(new HashSet<>(cloudIds));
    }
  }

  public static boolean liked(Context c, Song song) {
    if (song.uri.isEmpty()) {
      String value = session();
      synchronized (CACHE_LOCK) {
        syncSessionLocked(value);
        return known && cloudIds.contains(song.id);
      }
    }
    for (Song item : Song.read(c, "favorites"))
      if (item.id.equals(song.id)) return true;
    return false;
  }

  public static boolean toggle(Context c, Song song) throws Exception {
    if (!song.uri.isEmpty()) {
      ArrayList<Song> local = Song.read(c, "favorites");
      boolean wanted = !liked(c, song);
      if (wanted) local.add(song);
      else local.removeIf(item -> item.id.equals(song.id));
      Song.save(c, "favorites", local);
      return wanted;
    }

    synchronized (OPERATION_LOCK) {
      String started = session();
      if (started.isEmpty()) throw new IOException("请先登录网易云");
      long epoch;
      long revision;
      boolean refresh;
      synchronized (CACHE_LOCK) {
        syncSessionLocked(started);
        refresh = !known || android.os.SystemClock.elapsedRealtime() - refreshedAt > 30000;
      }
      if (refresh) refreshLocked(c);

      final boolean wanted;
      synchronized (CACHE_LOCK) {
        String current = session();
        syncSessionLocked(current);
        if (!started.equals(current)) throw new IOException("账号已切换，请重新同步喜欢状态");
        if (!known) throw new IOException("网易云喜欢状态尚未确认，请稍后重试");
        wanted = !cloudIds.contains(song.id);
        epoch = sessionEpoch;
        revision = mutationRevision;
      }

      Cloud cloud = new Cloud(c);
      cloud.like(song.id, wanted);
      Set<String> confirmed = cloud.likedIds();
      boolean confirmedLiked = confirmed.contains(song.id);
      String finished = session();
      synchronized (CACHE_LOCK) {
        syncSessionLocked(finished);
        if (!started.equals(finished) || epoch != sessionEpoch || revision != mutationRevision)
          throw new IOException("账号或喜欢状态已变化，请重新同步");
        cloudIds.clear();
        cloudIds.addAll(confirmed);
        known = true;
        refreshedAt = android.os.SystemClock.elapsedRealtime();
        mutationRevision++;
      }
      if (confirmedLiked != wanted) throw new IOException("网易云未确认喜欢状态变更，请稍后重试");
      return confirmedLiked;
    }
  }
}
