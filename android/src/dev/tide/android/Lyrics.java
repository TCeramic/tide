package dev.tide.android;

import java.util.*;
import java.util.regex.*;

public final class Lyrics {
  public static final class Line {
    public final long time;
    public final String text;

    Line(long t, String s) {
      time = t;
      text = s;
    }
  }

  public static List<Line> parse(String raw) {
    ArrayList<Line> out = new ArrayList<>();
    Pattern tag = Pattern.compile("\\[(\\d+):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]");
    long offset = 0;
    Matcher off = Pattern.compile("\\[offset:([+-]?\\d+)\\]").matcher(raw);
    if (off.find())
      try {
        offset = Long.parseLong(off.group(1));
      } catch (Exception ignored) {
      }
    for (String row : raw.split("\\r?\\n")) {
      Matcher m = tag.matcher(row);
      String text = row.replaceAll("\\[[^]]*\\]", "").trim();
      while (m.find()) {
        String f = m.group(3);
        long ms = f == null ? 0 : Long.parseLong((f + "000").substring(0, 3));
        out.add(
            new Line(
                Math.max(
                    0,
                    Long.parseLong(m.group(1)) * 60000
                        + Long.parseLong(m.group(2)) * 1000
                        + ms
                        + offset),
                text));
      }
    }
    Collections.sort(out, Comparator.comparingLong(l -> l.time));
    return out;
  }

  public static int index(List<Line> lines, long position) {
    int lo = 0, hi = lines.size() - 1, result = -1;
    while (lo <= hi) {
      int mid = (lo + hi) >>> 1;
      if (lines.get(mid).time <= position) {
        result = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return result;
  }
}
