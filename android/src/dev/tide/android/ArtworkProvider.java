package dev.tide.android;
import android.content.*;
import android.database.*;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import java.io.*;
/** Read-only artwork URIs granted to system media surfaces. */
public class ArtworkProvider extends ContentProvider {
  public boolean onCreate(){return true;}
  private File file(Uri uri)throws FileNotFoundException{
    String name=uri.getLastPathSegment();
    if(name==null||!name.matches("[A-Za-z0-9_.-]+\\.jpg"))throw new FileNotFoundException();
    File f=new File(getContext().getFilesDir(),name);
    try{if(!f.getCanonicalPath().startsWith(getContext().getFilesDir().getCanonicalPath()+File.separator))throw new FileNotFoundException();}catch(IOException e){throw new FileNotFoundException();}
    return f;
  }
  public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{
    if(!"r".equals(mode))throw new FileNotFoundException("read only");
    return ParcelFileDescriptor.open(file(uri),ParcelFileDescriptor.MODE_READ_ONLY);
  }
  public String getType(Uri uri){return "image/jpeg";}
  public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){
    try{File f=file(uri);String[] columns=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;
      MatrixCursor c=new MatrixCursor(columns);Object[] values=new Object[columns.length];for(int i=0;i<columns.length;i++)values[i]=OpenableColumns.SIZE.equals(columns[i])?f.length():f.getName();c.addRow(values);return c;
    }catch(Exception e){return null;}
  }
  public Uri insert(Uri u,ContentValues v){throw new UnsupportedOperationException();}
  public int delete(Uri u,String s,String[] a){throw new UnsupportedOperationException();}
  public int update(Uri u,ContentValues v,String s,String[] a){throw new UnsupportedOperationException();}
}
