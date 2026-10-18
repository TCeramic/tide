package dev.tide.android;

import android.content.Context;
import android.graphics.*;
import android.view.View;

/** Bounded 2D visual fallback: no GPU extension or vendor dependency. */
public class Backdrop extends View {
  private final Paint paint = new Paint(3);
  private float phase;
  private boolean running;
  public Bitmap cover;
  public boolean light, pixel, still;
  public int accent = Color.rgb(67, 172, 194);

  public Backdrop(Context c) {
    super(c);
    setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);
  }

  public void active(boolean value) {
    running = value;
    if (value) invalidate();
  }

  protected void onDraw(Canvas c) {
    super.onDraw(c);
    int w = getWidth(), h = getHeight();
    c.drawColor(light ? 0xffe5edf0 : 0xff0c1524);
    if (cover != null && pixel) {
      paint.setAlpha(light ? 80 : 65);
      c.drawBitmap(cover, null, new Rect(0, 0, w, h), paint);
      paint.setAlpha(255);
    }
    float amplitude = pixel ? .018f : .07f;
    float x = w * (.4f + amplitude * (float) Math.sin(phase)),
        y = h * (.35f + amplitude * (float) Math.cos(phase * .8));
    paint.setShader(
        new RadialGradient(
            x,
            y,
            Math.max(w, h) * .8f,
            new int[] {(light ? 0x70ffffff : 0x70000000) | (accent & 0xffffff), 0x00436476},
            null,
            Shader.TileMode.CLAMP));
    c.drawRect(0, 0, w, h, paint);
    paint.setShader(null);
    if (pixel && cover != null) {
      int[] bayer = {0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5};
      int step = Math.max(5, w / 105);
      paint.setColor(light ? 0xff264659 : 0xffe9eaf4);
      for (int yy = 0; yy < h; yy += step)
        for (int xx = 0; xx < w; xx += step) {
          int color =
              cover.getPixel(
                  Math.min(cover.getWidth() - 1, xx * cover.getWidth() / Math.max(1, w)),
                  Math.min(cover.getHeight() - 1, yy * cover.getHeight() / Math.max(1, h)));
          float l =
              (Color.red(color) * .2126f + Color.green(color) * .7152f + Color.blue(color) * .0722f)
                  / 255;
          float edge = Math.abs(l - .5f);
          float threshold = (bayer[((yy / step) & 3) * 4 + ((xx / step) & 3)] + .5f) / 16;
          if (edge < .32 && threshold > l) {
            paint.setAlpha(light ? 48 : 54);
            c.drawRect(xx, yy, xx + step * .42f, yy + step * .42f, paint);
          }
        }
      paint.setAlpha(255);
    }
    if (running && !still) {
      phase += pixel ? .003f : .012f;
      postInvalidateDelayed(33);
    }
  }
}
