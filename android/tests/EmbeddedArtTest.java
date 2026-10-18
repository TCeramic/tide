package dev.tide.android;
import java.io.*;
import java.util.*;
public class EmbeddedArtTest {
  static final byte[] JPEG={(byte)255,(byte)216,(byte)255,10,20,30};
  static void equal(byte[] actual){if(!Arrays.equals(actual,JPEG))throw new AssertionError("artwork mismatch");}
  public static void main(String[] args)throws Exception{
    for(int version:new int[]{3,4}){
      ByteArrayOutputStream picture=new ByteArrayOutputStream();DataOutputStream p=new DataOutputStream(picture);p.writeByte(0);p.writeBytes("image/jpeg");p.writeByte(0);p.writeByte(3);p.writeByte(0);p.write(JPEG);
      ByteArrayOutputStream frame=new ByteArrayOutputStream();DataOutputStream f=new DataOutputStream(frame);f.writeBytes("APIC");f.writeInt(picture.size());f.writeShort(0);f.write(picture.toByteArray());
      ByteArrayOutputStream tag=new ByteArrayOutputStream();DataOutputStream t=new DataOutputStream(tag);t.writeBytes("ID3");t.writeByte(version);t.writeShort(0);t.writeInt(frame.size());t.write(frame.toByteArray());equal(EmbeddedArt.read(new ByteArrayInputStream(tag.toByteArray())));
    }
    ByteArrayOutputStream picture=new ByteArrayOutputStream();DataOutputStream p=new DataOutputStream(picture);p.writeInt(3);p.writeInt(10);p.writeBytes("image/jpeg");p.writeInt(0);for(int i=0;i<4;i++)p.writeInt(100);p.writeInt(JPEG.length);p.write(JPEG);
    ByteArrayOutputStream flac=new ByteArrayOutputStream();DataOutputStream f=new DataOutputStream(flac);f.writeBytes("fLaC");f.writeByte(134);f.writeByte(0);f.writeShort(picture.size());f.write(picture.toByteArray());equal(EmbeddedArt.read(new ByteArrayInputStream(flac.toByteArray())));
    if(EmbeddedArt.read(new ByteArrayInputStream(new byte[]{1,2,3,4}))!=null)throw new AssertionError();
    try{EmbeddedArt.read(new ByteArrayInputStream(new byte[]{'f','L','a','C',(byte)134,0,0,3,1,2,3}));throw new AssertionError();}catch(IOException expected){}
    System.out.println("MP3_ID3_V23_V24_FLAC_UNKNOWN_AND_TRUNCATED_ARTWORK passed");
  }
}
