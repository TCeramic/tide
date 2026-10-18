package dev.tide.android;

import java.util.List;

/** Dependency-free regression runner; executes on the host JVM. */
public final class LyricsTest {
  private static void check(boolean value) {
    if (!value) throw new AssertionError("Lyric regression");
  }

  public static void main(String[] args) {
    List<Lyrics.Line> rows = Lyrics.parse("[ar:Artist]\n[offset:250]\n[00:20.12]later\n[00:01.5][00:05.050]repeat\n[00:00]intro");
    check(rows.size() == 4);
    check(rows.get(0).time == 250 && rows.get(0).text.equals("intro"));
    check(rows.get(1).time == 1750 && rows.get(2).time == 5300);
    check(rows.get(3).time == 20370);
    check(Lyrics.index(rows, 249) == -1);
    check(Lyrics.index(rows, 1750) == 1);
    check(Lyrics.index(rows, 6000) == 2);
    check(Lyrics.index(rows, 999999) == 3);
    check(Lyrics.parse("metadata only").isEmpty());
    check(Lyrics.parse("[offset:-2000]\n[00:01]line").get(0).time == 0);
    System.out.println("ANDROID_LRC_MULTI_TAG_OFFSET_SORT_SEEK passed (10 assertions)");
  }
}
