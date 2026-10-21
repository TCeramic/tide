package dev.tide.android;

import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.media.*;
import android.media.session.*;
import android.net.Uri;
import android.os.*;
import java.util.*;
import java.util.concurrent.*;

/** One player and one session, owned by the foreground service rather than the Activity. */
public class PlaybackService extends Service {
  public static final String UPDATE = "dev.tide.android.UPDATE";
  public static PlaybackService instance;
  public final ArrayList<Song> queue = new ArrayList<>();
  public int index = -1;
  public boolean playing, loading;
  public String error = "", lyricRaw = "";
  public List<Lyrics.Line> lyrics = Collections.emptyList();
  public List<Lyrics.Line> translations=Collections.emptyList(),romaji=Collections.emptyList();
  private MediaPlayer player;
  private Bitmap songArt;
  private MediaSession session;
  private AudioManager audio;
  private AudioFocusRequest focus;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final ExecutorService worker = Executors.newFixedThreadPool(2);
  private int generation;
  private boolean prepared, resumeFocus;
  private boolean foreground;
  private boolean playWhenReady;
  private boolean inspirationLoading;
  private long pendingSeekPosition = -1;
  private final Runnable checkpoint = new Runnable() {
    public void run() {
      if (!playing) return;
      persistPosition();
      handler.postDelayed(this, 5000);
    }
  };

  public Song current() {
    return index >= 0 && index < queue.size() ? queue.get(index) : null;
  }

  /** Refresh metadata after a persisted library item gains its embedded cover. */
  public void refreshLibraryArtwork(List<Song> library) {
    for (Song queued : queue) for (Song local : library)
      if (queued.id.equals(local.id) && !local.cover.isEmpty()) queued.cover = local.cover;
    Song song = current();
    if (song == null || song.cover.isEmpty()) return;
    final int token = generation;
    worker.execute(() -> {
      Bitmap art = Artwork.load(this, song.cover, 256);
      handler.post(() -> { if (token == generation && art != null) { metadata(art); changed(); } });
    });
  }

  private final BroadcastReceiver noisy =
      new BroadcastReceiver() {
        public void onReceive(Context c, Intent i) {
          pause();
        }
      };

  public void onCreate() {
    super.onCreate();
    instance = this;
    audio = (AudioManager) getSystemService(AUDIO_SERVICE);
    getSystemService(NotificationManager.class)
        .createNotificationChannel(
            new NotificationChannel("playback", "音乐播放", NotificationManager.IMPORTANCE_LOW));
    focus =
        new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build())
            .setOnAudioFocusChangeListener(
                change -> {
                  if (change == AudioManager.AUDIOFOCUS_GAIN) {
                    if (player != null) player.setVolume(1, 1);
                    if (resumeFocus) {
                      resumeFocus = false;
                      resume();
                    }
                  } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                    if (player != null) player.setVolume(.2f, .2f);
                  } else {
                    resumeFocus = change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT && playing;
                    pause();
                  }
                })
            .build();
    session = new MediaSession(this, "Tide");
    session.setRatingType(Rating.RATING_HEART);
    Bundle mediaExtras=new Bundle();mediaExtras.putBoolean("android.media.playback.ALWAYS_RESERVE_SPACE_FOR.ACTION_SKIP_TO_PREVIOUS",true);mediaExtras.putBoolean("android.media.playback.ALWAYS_RESERVE_SPACE_FOR.ACTION_SKIP_TO_NEXT",true);session.setExtras(mediaExtras);
    session.setFlags(
        MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
    session.setCallback(
        new MediaSession.Callback() {
          public void onPlay() {
            resume();
          }

          public void onPause() {
            pause();
          }

          public void onSkipToNext() {
            next(1);
          }

          public void onSkipToPrevious() {
            next(-1);
          }

          public void onSeekTo(long p) {
            seek(p);
          }

          public void onCustomAction(String action,Bundle extras){if("favorite".equals(action)||"like".equals(action)) toggleFavorite();else if("previous".equals(action))next(-1);}
          public void onSetRating(Rating rating){if(rating!=null&&rating.hasHeart()!=isFavorite())toggleFavorite();}

          public void onStop() {
            stopSelf();
          }
        });
    session.setSessionActivity(
        PendingIntent.getActivity(
            this,
            0,
            new Intent(this, MainActivity.class),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
    session.setActive(true);
    if (Build.VERSION.SDK_INT >= 33)
      registerReceiver(
          noisy,
          new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
          Context.RECEIVER_NOT_EXPORTED);
    else registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
    queue.addAll(Song.read(this, "queue"));
    index = getSharedPreferences("tide", 0).getInt("queueIndex", 0);
    if (index >= queue.size()) index = 0;
  }

  public int onStartCommand(Intent intent, int flags, int id) {
    if (intent == null) return START_NOT_STICKY;
    String action = intent.getAction();
    if ("start".equals(action)) {
      promote();
      try {
        ArrayList<Song> next = new ArrayList<>();
        org.json.JSONArray j = new org.json.JSONArray(intent.getStringExtra("queue"));
        for (int n = 0; n < j.length(); n++) next.add(Song.from(j.getJSONObject(n)));
        if (next.isEmpty()) throw new IllegalArgumentException("播放列表为空");
        queue.clear();
        queue.addAll(next);
        play(intent.getIntExtra("index", 0));
      } catch (Exception e) {
        fail("无法读取播放队列");
      }
    } else if ("toggle".equals(action)) {
      if (playing) pause();
      else resume();
    } else if ("restore".equals(action)) {
      restorePaused();
    } else if ("next".equals(action)) next(1);
    else if ("previous".equals(action)) next(-1);
    else if ("favorite".equals(action)) toggleFavorite();
    else if ("stop".equals(action)) stopSelf();
    return START_NOT_STICKY;
  }

  public static void start(Context c, List<Song> rows, int at) {
    org.json.JSONArray a = new org.json.JSONArray();
    for (Song s : rows) a.put(s.json());
    Intent i =
        new Intent(c, PlaybackService.class)
            .setAction("start")
            .putExtra("queue", a.toString())
            .putExtra("index", at);
    c.startForegroundService(i);
  }

  /** Rebuild the last player in a paused state after Android has killed the app process. */
  public static void restoreIfAvailable(Context c) {
    if (instance != null || Song.read(c, "queue").isEmpty()) return;
    Intent intent = new Intent(c, PlaybackService.class).setAction("restore");
    if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(intent);
    else c.startService(intent);
  }

  private void restorePaused() {
    if (current() == null || player != null || loading) return;
    long savedPosition = Math.max(0, getSharedPreferences("tide", 0).getLong("resumePosition", 0));
    play(index, savedPosition, false, true);
  }

  public void play(int at) {
    play(at, 0, true, false);
  }

  private void play(int at, long savedPosition, boolean shouldPlay, boolean restoring) {
    if (queue.isEmpty()) return;
    index = (at % queue.size() + queue.size()) % queue.size();
    Song song = current();
    int token = ++generation;
    releasePlayer();
    error = "";
    lyricRaw = "";
    songArt = null;
    lyrics = Collections.emptyList(); translations=Collections.emptyList();romaji=Collections.emptyList();
    loading = true;
    playing = false;
    playWhenReady = shouldPlay;
    pendingSeekPosition = -1;
    Song.save(this, "queue", queue);
    android.content.SharedPreferences.Editor resume = getSharedPreferences("tide", 0).edit().putInt("queueIndex", index);
    if (!restoring) resume.putLong("resumePosition", 0);
    resume.apply();
    promote();
    metadata(null);
    changed();
    worker.execute(
        () -> {
          try {
            String uri =
                new Cloud(this)
                    .stream(song, getSharedPreferences("tide", 0).getString("quality", "standard"));
            handler.post(
                () -> {
                  if (token != generation) return;
                  try {
                    player = new MediaPlayer();
                    player.setAudioAttributes(
                        new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build());
                    player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
                    player.setOnPreparedListener(
                        p -> {
                          if (token != generation) return;
                          prepared = true;
                          loading = false;
                          song.duration = p.getDuration();
                          metadata(null);
                          if (savedPosition > 0) {
                            long seekTo = Math.min(savedPosition, Math.max(0, p.getDuration() - 1000));
                            pendingSeekPosition = seekTo;
                            getSharedPreferences("tide", 0).edit().putLong("resumePosition", seekTo).apply();
                            p.seekTo((int) seekTo, MediaPlayer.SEEK_CLOSEST);
                          }
                          if (playWhenReady) resume();
                          else {
                            if (savedPosition <= 0) persistPosition();
                            changed();
                            if (foreground) {
                              stopForeground(false);
                              foreground = false;
                            }
                          }
                      });
                    player.setOnSeekCompleteListener(p -> {
                      if (token != generation || p != player) return;
                      pendingSeekPosition = -1;
                      persistPosition();
                      changed();
                    });
                    player.setOnCompletionListener(
                        p -> {
                          String repeat =
                              getSharedPreferences("tide", 0).getString("repeat", "list");
                          if (repeat.equals("one")) play(index);
                          else next(1);
                        });
                    player.setOnErrorListener(
                        (p, w, e) -> {
                          if (token == generation) fail("无法解码此音频 (" + w + "/" + e + ")");
                          return true;
                        });
                    if (song.uri.isEmpty()) {
                      Map<String,String> headers=new HashMap<>();headers.put("Referer","https://music.163.com/");headers.put("User-Agent","Mozilla/5.0 TideAndroid");
                      player.setDataSource(PlaybackService.this,Uri.parse(uri),headers);
                    } else player.setDataSource(this, Uri.parse(uri));
                    player.prepareAsync();
                  } catch (Exception e) {
                    fail("无法打开音频：" + e.getMessage());
                  }
                });
            String loaded;
            String translated="", romanized="";
            try {
              if(song.uri.isEmpty()) {
                org.json.JSONObject bundle=new Cloud(this).lyricBundle(song);
                loaded=bundle.optJSONObject("lrc")==null?"":bundle.getJSONObject("lrc").optString("lyric");
                translated=bundle.optJSONObject("tlyric")==null?"":bundle.getJSONObject("tlyric").optString("lyric");
                romanized=bundle.optJSONObject("romalrc")==null?"":bundle.getJSONObject("romalrc").optString("lyric");
              }else loaded=localLyrics(song);
            } catch (Exception ignored) {
              loaded = "";
            }
            final String text = loaded, translation=translated, roman=romanized;
            Bitmap art = Artwork.load(this, song.cover, 256);
            handler.post(
                () -> {
                  if (token == generation) {
                    lyricRaw = text;
                    lyrics = Lyrics.parse(text); translations=Lyrics.parse(translation);romaji=Lyrics.parse(roman);
                    metadata(art);
                    changed();
                  }
                });
          } catch (Exception e) {
            handler.post(
                () -> {
                  if (token == generation) fail(e.getMessage() == null ? "播放失败" : e.getMessage());
                });
          }
        });
  }

  private String localLyrics(Song s) {
    try {
      java.io.File f = new java.io.File(getFilesDir(), "lyrics-" + s.id + ".lrc");
      if (f.isFile())
        return new String(
            java.nio.file.Files.readAllBytes(f.toPath()), java.nio.charset.StandardCharsets.UTF_8);
    } catch (Exception ignored) {
    }
    return "";
  }

  public void next(int direction) {
    if (queue.isEmpty()) return;
    if(direction>0&&index==queue.size()-1&&getSharedPreferences("tide",0).getString("repeat","list").equals("inspiration")&&current()!=null&&current().uri.isEmpty()){
      if(inspirationLoading)return;inspirationLoading=true;playWhenReady=true;final int token=generation;final Song seed=current();loading=true;changed();
      worker.execute(()->{ArrayList<Song> additions=new ArrayList<>();try{additions=new Cloud(this).similar(seed.id);}catch(Exception ignored){}final ArrayList<Song> found=additions;handler.post(()->{inspirationLoading=false;if(token!=generation)return;loading=false;if(!getSharedPreferences("tide",0).getString("repeat","list").equals("inspiration")){changed();return;}Set<String> known=new HashSet<>();for(Song song:queue)known.add(song.id);int nextIndex=queue.size();for(Song song:found)if(known.add(song.id))queue.add(song);if(queue.size()>nextIndex){boolean resume=playWhenReady;play(nextIndex);if(!resume)pause();}else{error="暂无更多相似歌曲，保留当前播放列表";changed();}});});return;
    }
    if (getSharedPreferences("tide", 0).getString("repeat", "list").equals("shuffle")
        && queue.size() > 1)
      play((index + 1 + new Random().nextInt(queue.size() - 1)) % queue.size());
    else play(index + direction);
  }

  public void resume() {
    playWhenReady = true;
    if (loading) return;
    if (player == null || !prepared) {
      if (current() != null) play(index);
      return;
    }
    promote();
    if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
      error = "其他应用正在占用音频";
      changed();
      stopForeground(false);
      foreground = false;
      return;
    }
    try {
      promote();
      player.start();
      playing = true;
      error = "";
      handler.removeCallbacks(checkpoint);
      handler.postDelayed(checkpoint, 5000);
      changed();
    } catch (Exception e) {
      fail("恢复播放失败");
    }
  }

  public void pause() {
    playWhenReady = false;
    handler.removeCallbacks(checkpoint);
    if (player != null && prepared)
      try {
        player.pause();
      } catch (Exception ignored) {
      }
    playing = false;
    persistPosition();
    changed();
    if (foreground) {
      stopForeground(false);
      foreground = false;
    }
  }

  public void seek(long position) {
    if (player != null && prepared)
      try {
        long target = Math.max(0, Math.min(position, duration()));
        pendingSeekPosition = target;
        getSharedPreferences("tide", 0).edit().putLong("resumePosition", target).apply();
        player.seekTo((int) target, MediaPlayer.SEEK_CLOSEST);
        changed();
      } catch (Exception ignored) {
      }
  }

  public long position() {
    try {
      return player != null && prepared ? player.getCurrentPosition() : 0;
    } catch (Exception e) {
      return 0;
    }
  }

  public long duration() {
    try {
      return player != null && prepared
          ? player.getDuration()
          : current() == null ? 0 : current().duration;
    } catch (Exception e) {
      return 0;
    }
  }

  private void persistPosition() {
    // A newly created/restoring player reports 0 until prepare completes. Preserve the
    // last checkpoint during that window instead of overwriting it with a false zero.
    if (!prepared || player == null) return;
    if (pendingSeekPosition >= 0) {
      getSharedPreferences("tide", 0).edit().putLong("resumePosition", pendingSeekPosition).apply();
      return;
    }
    long position = position();
    if (position < 0) return;
    getSharedPreferences("tide", 0).edit().putLong("resumePosition", position).apply();
  }

  private void metadata(Bitmap bitmap) {
    Song s = current();
    if (s == null) return;
    MediaMetadata.Builder b =
        new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, s.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, s.artist)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, duration());
    if (bitmap != null) songArt = bitmap;
    if (songArt != null)
      b.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, songArt)
          .putBitmap(MediaMetadata.METADATA_KEY_ART, songArt)
          .putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, songArt);
    String art=s.cover;
    if (!art.isEmpty()) {
      if (!art.startsWith("https://")) {
        art="content://dev.tide.android.artwork/"+new java.io.File(art).getName();
        for(String target:new String[]{"com.android.systemui","com.oplus.systemui","android"})try{grantUriPermission(target,Uri.parse(art),Intent.FLAG_GRANT_READ_URI_PERMISSION);}catch(Exception ignored){}
      }
      b.putString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI,art).putString(MediaMetadata.METADATA_KEY_ART_URI,art).putString(MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI,art);
    }
    b.putString(MediaMetadata.METADATA_KEY_MEDIA_ID,s.id).putRating(MediaMetadata.METADATA_KEY_USER_RATING,(!s.uri.isEmpty()||Favorites.known?Rating.newHeartRating(isFavorite()):Rating.newUnratedRating(Rating.RATING_HEART))).putRating(MediaMetadata.METADATA_KEY_RATING,Rating.newUnratedRating(Rating.RATING_HEART));
    session.setMetadata(b.build());
  }

  private PendingIntent command(String action, int id) {
    return PendingIntent.getService(
        this,
        id,
        new Intent(this, PlaybackService.class).setAction(action),
        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }

  private boolean isFavorite(){Song song=current();return song!=null&&Favorites.liked(this,song);}
  public void refreshFavorite(){metadata(null);changed();}
  private void toggleFavorite(){
    Song song=current();if(song==null)return;
    worker.execute(()->{try{Favorites.toggle(this,song);handler.post(()->refreshFavorite());}
      catch(Exception e){handler.post(()->android.widget.Toast.makeText(this,e.getMessage(),android.widget.Toast.LENGTH_LONG).show());}});
  }

  private Notification notification() {
    Song s = current();
    Notification.Builder b =
        new Notification.Builder(this, "playback")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(s == null ? "潮汐 Tide" : s.title)
            .setContentText(s == null ? "正在准备播放" : loading ? "正在加载…" : s.artist)
            .setContentIntent(session.getController().getSessionActivity())
            .setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(playing || loading)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .addAction(new Notification.Action.Builder(isFavorite()?R.drawable.heart_filled:R.drawable.heart_outline,isFavorite()?"取消喜欢":"喜欢",command("favorite",5)).build())
            .addAction(
                new Notification.Action.Builder(
                        android.R.drawable.ic_media_previous, "上一首", command("previous", 1))
                    .build())
            .addAction(
                new Notification.Action.Builder(
                        playing
                            ? android.R.drawable.ic_media_pause
                            : android.R.drawable.ic_media_play,
                        playing ? "暂停" : "播放",
                        command("toggle", 2))
                    .build())
            .addAction(
                new Notification.Action.Builder(
                        android.R.drawable.ic_media_next, "下一首", command("next", 3))
                    .build())
            .addAction(
                new Notification.Action.Builder(
                        android.R.drawable.ic_menu_close_clear_cancel, "停止", command("stop", 4))
                    .build())
            .setStyle(
                new Notification.MediaStyle()
                    .setMediaSession(session.getSessionToken())
                    .setShowActionsInCompactView(0, 2, 3));
    MediaMetadata m = session.getController().getMetadata();
    if (m != null && m.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART) != null)
      b.setLargeIcon(m.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART));
    return b.build();
  }

  private void promote() {
    startForeground(11, notification());
    foreground = true;
  }

  private void changed() {
    if (session == null) return;
    int state =
        loading
            ? PlaybackState.STATE_BUFFERING
            : playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
    PlaybackState.Builder p =
        new PlaybackState.Builder()
            .setActions(
                PlaybackState.ACTION_PLAY
                    | PlaybackState.ACTION_PAUSE
                    | PlaybackState.ACTION_PLAY_PAUSE
                    | PlaybackState.ACTION_SKIP_TO_NEXT
                    | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackState.ACTION_SET_RATING
                    | PlaybackState.ACTION_SEEK_TO
                    | PlaybackState.ACTION_STOP)
            .setState(
                error.isEmpty() ? state : PlaybackState.STATE_ERROR, position(), playing ? 1 : 0);
    if (!error.isEmpty()) p.setErrorMessage(error);
    p.addCustomAction(new PlaybackState.CustomAction.Builder("like","like",isFavorite()?R.drawable.heart_filled:R.drawable.heart_outline).build());
    session.setPlaybackState(p.build());
    getSystemService(NotificationManager.class).notify(11, notification());
    sendBroadcast(new Intent(UPDATE).setPackage(getPackageName()));
  }

  private void fail(String text) {
    error = text;
    loading = false;
    playing = false;
    releasePlayer();
    changed();
    if (foreground) {
      stopForeground(false);
      foreground = false;
    }
  }

  private void releasePlayer() {
    prepared = false;
    if (player != null) {
      player.release();
      player = null;
    }
  }

  public void onDestroy() {
    persistPosition();
    handler.removeCallbacks(checkpoint);
    generation++;
    releasePlayer();
    audio.abandonAudioFocusRequest(focus);
    session.setActive(false);
    session.release();
    unregisterReceiver(noisy);
    worker.shutdownNow();
    handler.removeCallbacksAndMessages(null);
    stopForeground(true);
    getSystemService(NotificationManager.class).cancel(11);
    instance = null;
    super.onDestroy();
  }

  public void onTaskRemoved(Intent rootIntent) {
    persistPosition();
    super.onTaskRemoved(rootIntent);
  }

  public IBinder onBind(Intent i) {
    return null;
  }
}
