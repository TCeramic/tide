// Compile the production Cloud/AuthRequestEnvelope classes against temporary
// Android/org.json stubs, then intercept every HTTPS URL before it can leave
// the process. No account, network service, SMS, or device is used.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const assert = require('assert/strict');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-request-envelope-'));
const sourceRoot = path.join(temp, 'src');
const classes = path.join(temp, 'classes');
fs.mkdirSync(classes, { recursive: true });

const stubs = {
  'android/content/ContentResolver.java': `package android.content; public class ContentResolver {}`,
  'android/content/SharedPreferences.java': `package android.content; public interface SharedPreferences { String getString(String key,String fallback); Editor edit(); interface Editor { Editor putString(String key,String value); void apply(); } }`,
  'android/content/Context.java': `package android.content; import java.util.concurrent.ConcurrentHashMap; public class Context { public static final int MODE_PRIVATE=0; private static final ConcurrentHashMap<String,String> values=new ConcurrentHashMap<>(); private final ContentResolver resolver=new ContentResolver(); public Context getApplicationContext(){return this;} public ContentResolver getContentResolver(){return resolver;} public SharedPreferences getSharedPreferences(String name,int mode){return new SharedPreferences(){ public String getString(String key,String fallback){return values.getOrDefault(name+"/"+key,fallback);} public Editor edit(){return new Editor(){ public Editor putString(String key,String value){values.put(name+"/"+key,value);return this;} public void apply(){} };} };} }`,
  'android/os/Looper.java': `package android.os; public class Looper { private static final Looper MAIN=new Looper(); public static Looper getMainLooper(){return MAIN;} public static Looper myLooper(){return MAIN;} }`,
  'android/os/Handler.java': `package android.os; public class Handler { public Handler(Looper looper){} public boolean post(Runnable r){r.run();return true;} }`,
  'android/os/Build.java': `package android.os; public final class Build { public static final class VERSION { public static final String RELEASE="13"; } }`,
  'android/webkit/ValueCallback.java': `package android.webkit; public interface ValueCallback<T> { void onReceiveValue(T value); }`,
  'android/webkit/CookieManager.java': `package android.webkit; public class CookieManager { private static final CookieManager INSTANCE=new CookieManager(); private static final String COOKIE="MUSIC_U=fixture-session; __csrf=fixture-csrf"; public static CookieManager getInstance(){return INSTANCE;} public String getCookie(String url){return COOKIE;} public void setCookie(String url,String value,ValueCallback<Boolean> callback){if(callback!=null)callback.onReceiveValue(Boolean.TRUE);} public void flush(){} }`,
  'android/provider/Settings.java': `package android.provider; import android.content.ContentResolver; public final class Settings { public static final class Secure { public static final String ANDROID_ID="android_id"; public static String getString(ContentResolver resolver,String key){return "android-device-fixture";} } }`,
  'android/net/Uri.java': `package android.net; import java.net.URLEncoder; import java.nio.charset.StandardCharsets; public final class Uri { public static String encode(String value){return URLEncoder.encode(value,StandardCharsets.UTF_8).replace("+","%20").replace("%21","!").replace("%27","'").replace("%28","(").replace("%29",")").replace("%7E","~");} }`,
  'android/util/Base64.java': `package android.util; public final class Base64 { public static final int DEFAULT=0,NO_WRAP=2; public static byte[] decode(String value,int flags){return java.util.Base64.getDecoder().decode(value);} public static String encodeToString(byte[] value,int flags){return java.util.Base64.getEncoder().encodeToString(value);} }`,
  'org/json/JSONObject.java': String.raw`package org.json;
import java.util.*;
public class JSONObject {
  private final LinkedHashMap<String,Object> values = new LinkedHashMap<>();
  public JSONObject() {}
  public JSONObject(Map<?,?> source) { for (Map.Entry<?,?> entry : source.entrySet()) values.put(String.valueOf(entry.getKey()), entry.getValue()); }
  public JSONObject(String raw) {
    if (raw.contains("\"code\":200")) values.put("code", 200);
  }
  public JSONObject put(String key,Object value){values.put(key,value);return this;}
  public boolean has(String key){return values.containsKey(key);}
  public String optString(String key){return optString(key,"");}
  public String optString(String key,String fallback){Object value=values.get(key);return value==null?fallback:String.valueOf(value);}
  public int optInt(String key){return optInt(key,0);}
  public int optInt(String key,int fallback){Object value=values.get(key);try{return value==null?fallback:Integer.parseInt(String.valueOf(value));}catch(Exception ignored){return fallback;}}
  public long optLong(String key){return optLong(key,0L);}
  public long optLong(String key,long fallback){Object value=values.get(key);try{return value==null?fallback:Long.parseLong(String.valueOf(value));}catch(Exception ignored){return fallback;}}
  public JSONObject optJSONObject(String key){Object value=values.get(key);return value instanceof JSONObject?(JSONObject)value:null;}
  public JSONArray optJSONArray(String key){Object value=values.get(key);return value instanceof JSONArray?(JSONArray)value:null;}
  public JSONObject getJSONObject(String key){return (JSONObject)values.get(key);}
  public JSONArray getJSONArray(String key){return (JSONArray)values.get(key);}
  public String getString(String key){return String.valueOf(values.get(key));}
  public String toString(){StringJoiner join=new StringJoiner(",","{","}");for(Map.Entry<String,Object> e:values.entrySet())join.add(quote(e.getKey())+":"+json(e.getValue()));return join.toString();}
  static String json(Object value){if(value==null)return "null";if(value instanceof String)return quote((String)value);return String.valueOf(value);}
  static String quote(String value){return "\""+value.replace("\\","\\\\").replace("\"","\\\"")+"\"";}
}`,
  'org/json/JSONArray.java': `package org.json; import java.util.*; public class JSONArray { private final ArrayList<Object> values=new ArrayList<>(); public JSONArray(){} public JSONArray(String raw){} public JSONArray put(Object value){values.add(value);return this;} public int length(){return values.size();} public JSONObject getJSONObject(int index){return (JSONObject)values.get(index);} public String getString(int index){return String.valueOf(values.get(index));} public String toString(){StringJoiner join=new StringJoiner(",","[","]");for(Object value:values)join.add(JSONObject.json(value));return join.toString();} }`,
  'dev/tide/android/Song.java': `package dev.tide.android; public class Song { public String id,title,artist,uri,cover; public long duration; public Song(String id,String title,String artist,String uri,String cover,long duration){this.id=id;this.title=title;this.artist=artist;this.uri=uri;this.cover=cover;this.duration=duration;} }`,
  'dev/tide/android/Favorites.java': `package dev.tide.android; import org.json.JSONArray; public final class Favorites { public static JSONArray ids(){return new JSONArray();} }`,
  'dev/tide/android/RequestEnvelopeHarness.java': `package dev.tide.android;
import android.content.Context;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class RequestEnvelopeHarness {
  private static final List<Captured> CAPTURED = new ArrayList<>();
  private static final Set<String> ALLOWED_HOSTS = Set.of("music.163.com", "interface.music.163.com");
  private static final String RAW_COOKIE = "MUSIC_U=fixture-session; __csrf=fixture-csrf";
  private static final class Captured {
    final URL url; final Map<String,String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
    final ByteArrayOutputStream body = new ByteArrayOutputStream(); final HttpURLConnection connection;
    Captured(URL url,HttpURLConnection connection){this.url=url;this.connection=connection;}
    String method(){try{return connection.getRequestMethod();}catch(Exception e){throw new AssertionError("request method unavailable");}}
    String header(String name){return headers.get(name);}
  }
  private static final class LocalConnection extends HttpURLConnection {
    final Captured captured;
    LocalConnection(URL url){super(url);captured=new Captured(url,this);CAPTURED.add(captured);}
    @Override public void setRequestProperty(String key,String value){captured.headers.put(key,value);}
    @Override public void addRequestProperty(String key,String value){captured.headers.merge(key,value,(a,b)->a+", "+b);}
    @Override public OutputStream getOutputStream(){return captured.body;}
    @Override public int getResponseCode(){return 200;}
    @Override public InputStream getInputStream(){String response="{"+(char)34+"code"+(char)34+":200}";return new ByteArrayInputStream(response.getBytes(StandardCharsets.UTF_8));}
    @Override public Map<String,List<String>> getHeaderFields(){return Collections.emptyMap();}
    @Override public void connect(){}
    @Override public void disconnect(){}
    @Override public boolean usingProxy(){return false;}
  }
  public static void main(String[] args) throws Exception {
    URL.setURLStreamHandlerFactory(protocol -> "https".equals(protocol) ? new URLStreamHandler(){
      @Override protected URLConnection openConnection(URL url) throws IOException {
        if(!ALLOWED_HOSTS.contains(url.getHost())) throw new IOException("blocked non-fixture host");
        return new LocalConnection(url);
      }
    } : null);
    Cloud cloud=new Cloud(new Context());
    cloud.captcha("13800000000");
    cloud.like("fixture-song",true);
    cloud.qrKey();
    cloud.qrCheck("fixture-qr-key");
    require(CAPTURED.size()==4,"expected exactly four locally intercepted requests");
    Captured sms=CAPTURED.get(0), like=CAPTURED.get(1), qrKey=CAPTURED.get(2), qrCheck=CAPTURED.get(3);
    require(sms.url.getPath().equals("/weapi/sms/captcha/sent"),"SMS request uses the production weapi endpoint");
    require("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36".equals(sms.header("User-Agent")),"SMS keeps the pre-existing Android 13 Chrome 120.0 UA");
    require(AuthRequestEnvelope.DEFAULT_WEAPI_UA.equals(sms.header("User-Agent")),"SMS policy resolves to the independent default UA reference");
    require(RAW_COOKIE.equals(sms.header("Cookie")),"SMS uses only the existing session cookie defaults");
    require(sms.header("Referer")!=null,"SMS retains the normal weapi Referer");
    require(sms.body.size()>0,"SMS request body was built");

    require(like.url.getPath().equals("/weapi/radio/like"),"like request uses the production like endpoint");
    require("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0".equals(like.header("User-Agent")),"like uses its dedicated pinned upstream UA");
    require(AuthRequestEnvelope.UPSTREAM_WEAPI_UA.equals(like.header("User-Agent")),"like policy resolves to the independent upstream UA reference");
    require(like.header("Referer")!=null,"like keeps the normal weapi Referer");
    Map<String,String> likeCookies=parseCookie(like.header("Cookie"));
    require("fixture-session".equals(likeCookies.get("MUSIC_U"))&&"fixture-csrf".equals(likeCookies.get("__csrf")),"like preserves current login cookies");
    for(String name:List.of("__remember_me","ntes_kaola_ad","_ntes_nuid","_ntes_nnid","WNMCID","WEVNSM","NMTID"))
      require(likeCookies.containsKey(name),"like upstream defaults include required cookie fields");
    require(!RAW_COOKIE.equals(like.header("Cookie")),"upstream-only cookie defaults are isolated to like");
    require(like.body.size()>0,"like request body was built");

    for(Captured qr:List.of(qrKey,qrCheck)){
      require("NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)".equals(qr.header("User-Agent")),"QR uses the pinned iPhone EAPI UA");
      require(AuthRequestEnvelope.QR_EAPI_UA.equals(qr.header("User-Agent")),"QR policy resolves to the independent iPhone UA reference");
      require(qr.header("Referer")==null,"QR EAPI request omits Referer");
      require("application/x-www-form-urlencoded".equals(qr.header("Content-Type")),"QR uses form-encoded EAPI body");
      require(qr.header("Cookie")!=null&&!qr.header("Cookie").isEmpty(),"QR carries generated client metadata cookies");
      require(qr.body.size()>0,"QR EAPI request body was built");
    }
    require(qrKey.url.getPath().equals("/eapi/login/qrcode/unikey"),"QR key uses the EAPI unikey endpoint");
    require(qrCheck.url.getPath().equals("/eapi/login/qrcode/client/login"),"QR confirmation uses the EAPI client login endpoint");
    Map<String,String> keyMetadata=parseCookie(qrKey.header("Cookie")), checkMetadata=parseCookie(qrCheck.header("Cookie"));
    require("pc".equals(keyMetadata.get("os")),"QR fixture chooses the expected PC client family");
    require("3.1.17.204416".equals(keyMetadata.get("appver")),"QR fixture uses expected PC application version");
    require("Microsoft-Windows-10-Professional-build-19045-64bit".equals(keyMetadata.get("osver")),"QR fixture uses expected PC OS version");
    require("netease".equals(keyMetadata.get("channel")),"QR fixture uses expected PC channel");
    require("140".equals(keyMetadata.get("versioncode")),"QR fixture uses expected client version code");
    require(validRequestId(keyMetadata.get("requestId")),"QR requestId has the expected metadata format");
    require(validRequestId(checkMetadata.get("requestId")),"QR check requestId has the expected metadata format");
    for(String key:List.of("os","appver","osver","channel","deviceId","versioncode","buildver","resolution","__csrf","MUSIC_U"))
      require(Objects.equals(keyMetadata.get(key),checkMetadata.get(key)),"QR key/check share client metadata");
    verifyQrPayload(qrKey,"/api/login/qrcode/unikey",keyMetadata,null);
    verifyQrPayload(qrCheck,"/api/login/qrcode/client/login",checkMetadata,"fixture-qr-key");
    System.out.println("ANDROID_CLOUD_REQUEST_ENVELOPES passed (4 locally intercepted requests; no network, SMS, or credentials emitted)");
  }
  private static Map<String,String> parseCookie(String cookie){
    require(cookie!=null,"required request Cookie header exists");Map<String,String> result=new LinkedHashMap<>();
    for(String item:cookie.split(";")){String[] pair=item.trim().split("=",2);if(pair.length==2)result.put(URLDecoder.decode(pair[0],StandardCharsets.UTF_8),URLDecoder.decode(pair[1],StandardCharsets.UTF_8));}
    return result;
  }
  private static boolean validRequestId(String value){
    if(value==null||value.length()!=18||value.charAt(13)!='_')return false;
    for(int i=0;i<value.length();i++)if(i!=13&&!Character.isDigit(value.charAt(i)))return false;
    return true;
  }
  private static void verifyQrPayload(Captured request,String path,Map<String,String> metadata,String qrKey) throws Exception {
    String form=request.body.toString(StandardCharsets.UTF_8);
    require(form.startsWith("params="),"QR body is a params form envelope");
    byte[] encrypted=decodeHex(form.substring("params=".length()));
    javax.crypto.Cipher cipher=javax.crypto.Cipher.getInstance("AES/ECB/PKCS5Padding");
    cipher.init(javax.crypto.Cipher.DECRYPT_MODE,new javax.crypto.spec.SecretKeySpec("e82ckenh8dichen8".getBytes(StandardCharsets.UTF_8),"AES"));
    String plaintext=new String(cipher.doFinal(encrypted),StandardCharsets.UTF_8);
    String marker="-36cd479b6b5-",prefix=path+marker;
    require(plaintext.startsWith(prefix),"QR body decrypts to the requested EAPI path");
    int signatureAt=plaintext.lastIndexOf(marker);
    require(signatureAt>=prefix.length(),"QR EAPI body contains its signature separator");
    String json=plaintext.substring(prefix.length(),signatureAt);
    String expectedDigest=md5("nobody"+path+"use"+json+"md5forencrypt");
    require(expectedDigest.equals(plaintext.substring(signatureAt+marker.length())),"QR EAPI body signature matches the serialized request");
    String q=Character.toString((char)34);
    require(json.contains(q+"type"+q+":3"),"QR body serializes client login type");
    for(String field:List.of("os","appver","osver","channel","deviceId","versioncode","buildver","resolution","requestId","MUSIC_U"))
      if(metadata.containsKey(field))require(json.contains(q+field+q+":"+q+metadata.get(field)+q),"QR body matches Cookie metadata field "+field);
    if(qrKey!=null)require(json.contains(q+"key"+q+":"+q+qrKey+q),"QR check body serializes its challenge key");
  }
  private static byte[] decodeHex(String value){
    require(value.length()>0&&value.length()%2==0,"QR params are even-length hex");byte[] result=new byte[value.length()/2];
    for(int i=0;i<result.length;i++)result[i]=(byte)Integer.parseInt(value.substring(i*2,i*2+2),16);
    return result;
  }
  private static String md5(String value) throws Exception {
    byte[] digest=java.security.MessageDigest.getInstance("MD5").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder result=new StringBuilder();
    for(byte item:digest)result.append(String.format(Locale.ROOT,"%02x",item&255));return result.toString();
  }
  private static void require(boolean condition,String message){if(!condition)throw new AssertionError(message);}
}`
};

function writeTree(base, entries) {
  for (const [relative, content] of Object.entries(entries)) {
    const target = path.join(base, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
}
function javaFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? javaFiles(full) : entry.name.endsWith('.java') ? [full] : [];
  });
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return result;
}

try {
  writeTree(sourceRoot, stubs);
  const production = [
    path.join(root, 'android/src/dev/tide/android/AuthRequestEnvelope.java'),
    path.join(root, 'android/src/dev/tide/android/Cloud.java')
  ];
  run('javac', ['-encoding', 'UTF-8', '-d', classes, ...javaFiles(sourceRoot), ...production]);
  const result = run('java', ['-cp', classes, 'dev.tide.android.RequestEnvelopeHarness']);
  process.stdout.write(result.stdout);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
