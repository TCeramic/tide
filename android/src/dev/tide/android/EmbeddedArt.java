package dev.tide.android;

import java.io.*;

/** Bounded fallback for devices whose MediaMetadataRetriever omits ID3/FLAC artwork. */
public final class EmbeddedArt {
  private static final int MAX = 16 * 1024 * 1024;

  public static byte[] read(InputStream source) throws IOException {
    DataInputStream in = new DataInputStream(new BufferedInputStream(source));
    byte[] signature = new byte[4];
    in.readFully(signature);
    if (signature[0] == 'f' && signature[1] == 'L' && signature[2] == 'a' && signature[3] == 'C') {
      for (int block = 0; block < 128; block++) {
        int header = in.readUnsignedByte(),
            size =
                (in.readUnsignedByte() << 16)
                    | (in.readUnsignedByte() << 8)
                    | in.readUnsignedByte();
        if (size > MAX) return null;
        if ((header & 127) == 6) {
          byte[] data = new byte[size];
          in.readFully(data);
          DataInputStream p = new DataInputStream(new ByteArrayInputStream(data));
          p.readInt();
          skip(p, p.readInt());
          skip(p, p.readInt());
          skip(p, 16);
          int length = p.readInt();
          if (length <= 0 || length > MAX || length > p.available()) return null;
          byte[] image = new byte[length];
          p.readFully(image);
          return image;
        }
        skip(in, size);
        if ((header & 128) != 0) break;
      }
    } else if (signature[0] == 'I' && signature[1] == 'D' && signature[2] == '3') {
      int version = signature[3] & 255;
      in.readUnsignedByte();
      int flags = in.readUnsignedByte();
      int size = sync(in.readInt());
      if (size < 1 || size > MAX || (flags & 128) != 0) return null;
      byte[] tag = new byte[size];
      in.readFully(tag);
      int offset = 0;
      if ((flags & 64) != 0) {
        if (size < 4) return null;
        int extended = integer(tag, 0);
        offset = version == 4 ? sync(extended) : extended + 4;
      }
      while (offset + 10 <= tag.length) {
        String name = new String(tag, offset, 4, java.nio.charset.StandardCharsets.US_ASCII);
        int length = integer(tag, offset + 4);
        if (version == 4) length = sync(length);
        offset += 10;
        if (length <= 0 || length > tag.length - offset) break;
        if (name.equals("APIC")) {
          int start = offset + 1;
          while (start < offset + length && tag[start] != 0) start++;
          start += 2;
          for (int i = start; i < offset + length - 3; i++)
            if ((tag[i] & 255) == 255 && (tag[i + 1] & 255) == 216 && (tag[i + 2] & 255) == 255
                || tag[i] == (byte) 137
                    && tag[i + 1] == 'P'
                    && tag[i + 2] == 'N'
                    && tag[i + 3] == 'G')
              return java.util.Arrays.copyOfRange(tag, i, offset + length);
        }
        offset += length;
      }
    }
    return null;
  }

  private static int integer(byte[] b, int o) {
    return ((b[o] & 255) << 24)
        | ((b[o + 1] & 255) << 16)
        | ((b[o + 2] & 255) << 8)
        | (b[o + 3] & 255);
  }

  private static int sync(int n) {
    return ((n >>> 24) & 127) << 21 | ((n >>> 16) & 127) << 14 | ((n >>> 8) & 127) << 7 | (n & 127);
  }

  private static void skip(DataInputStream in, int n) throws IOException {
    if (n < 0 || n > MAX) throw new IOException("invalid artwork length");
    while (n > 0) {
      int s = in.skipBytes(n);
      if (s == 0) {
        in.readByte();
        s = 1;
      }
      n -= s;
    }
  }
}
