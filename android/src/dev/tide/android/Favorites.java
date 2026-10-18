package dev.tide.android;

import android.content.Context;
import java.util.*;

/** Cloud ids are authoritative only after a successful account lookup. Local tracks stay local. */
public final class Favorites {
  private static final Set<String> cloudIds=new HashSet<>();
  public static volatile boolean known=false;
  public static void refresh(Context c) throws Exception {
    Set<String> ids=new Cloud(c).likedIds(); synchronized(Favorites.class){cloudIds.clear();cloudIds.addAll(ids);known=true;}
  }
  public static synchronized org.json.JSONArray ids(){return new org.json.JSONArray(cloudIds);}
  public static synchronized boolean liked(Context c,Song song){
    if(song.uri.isEmpty())return known&&cloudIds.contains(song.id);
    for(Song item:Song.read(c,"favorites"))if(item.id.equals(song.id))return true;
    return false;
  }
  public static boolean toggle(Context c,Song song) throws Exception {
    if(song.uri.isEmpty()) {
      if(!known)refresh(c);
      boolean wanted; synchronized(Favorites.class){wanted=!cloudIds.contains(song.id);} new Cloud(c).like(song.id,wanted);
      synchronized(Favorites.class){if(wanted)cloudIds.add(song.id);else cloudIds.remove(song.id);}
      return wanted;
    }
    ArrayList<Song> local=Song.read(c,"favorites");boolean wanted=!liked(c,song);
    if(wanted)local.add(song);else local.removeIf(item->item.id.equals(song.id));
    Song.save(c,"favorites",local);return wanted;
  }
}
