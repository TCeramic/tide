"""Build the native Android client with the official SDK tools and JDK 17+.

No Gradle download is required. Private signing material stays in artifacts/.
"""
from pathlib import Path
import hashlib
import os
import secrets
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
SDK = Path(os.environ.get("ANDROID_SDK_ROOT", ROOT / "artifacts/android-sdk"))
JAVA = Path(os.environ.get("JAVA_HOME", Path(shutil.which("javac") or "javac").resolve().parent.parent))
TOOLS = SDK / "build-tools/35.0.0"
PLATFORM = SDK / "platforms/android-35/android.jar"
VERSION = "0.3.1"
WINDOWS = os.name == "nt"
EXE = ".exe" if WINDOWS else ""
ENV = {**os.environ, "JAVA_HOME": str(JAVA), "PATH": str(JAVA / "bin") + os.pathsep + os.environ["PATH"]}


def run(*args):
    print("RUN", Path(str(args[0])).name, flush=True)
    subprocess.run([str(arg) for arg in args], check=True, env=ENV)


for required in (TOOLS / ("aapt2" + EXE), PLATFORM, JAVA / "bin" / ("javac" + EXE)):
    if not required.is_file():
        raise SystemExit(f"Missing build prerequisite: {required}; see android/README.md")

run(shutil.which("node") or "node", ROOT / "scripts/build-android-ui.mjs")
output = ROOT / "release/android"
output.mkdir(parents=True, exist_ok=True)
keys = ROOT / "artifacts/android-signing"
keys.mkdir(parents=True, exist_ok=True)
key, password = keys / "tide-local.jks", keys / "password.txt"
if not key.exists():
    password.write_text(secrets.token_hex(24) + "\n", encoding="utf-8")
    run(JAVA / "bin" / ("keytool" + EXE), "-genkeypair", "-keystore", key,
        "-storepass:file", password, "-keypass:file", password, "-alias", "tide",
        "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
        "-dname", "CN=Tide Local Distribution, O=Tide")

# aapt2 on Windows cannot reliably open Unicode paths. Only disposable build inputs
# are copied to the system temp directory; the source and signing key remain intact.
with tempfile.TemporaryDirectory(prefix="tide-android-") as temporary:
    work = Path(temporary)
    if not str(work).isascii():
        raise SystemExit("Set TMP/TEMP to an ASCII directory for Android SDK tools.")
    source = work / "source"
    shutil.copytree(ROOT / "android", source)
    jar = work / "android.jar"
    shutil.copyfile(PLATFORM, jar)
    classes = work / "classes"
    classes.mkdir()
    run(TOOLS / ("aapt2" + EXE), "compile", "--dir", source / "res", "-o", work / "res.zip")
    run(TOOLS / ("aapt2" + EXE), "link", "-o", work / "base.apk", "-I", jar,
        "--manifest", source / "AndroidManifest.xml", "--java", work / "generated",
        "--min-sdk-version", "26", "--target-sdk-version", "35", "-A", source / "assets", work / "res.zip")
    java_args = ["-encoding", "UTF-8", "-source", "8", "-target", "8", "-classpath", str(jar),
                 "-d", str(classes)]
    java_args.extend(str(p) for directory in (source / "src", work / "generated")
                     for p in sorted(directory.rglob("*.java")))
    argfile = work / "javac.args"
    argfile.write_text("\n".join('"' + arg.replace("\\", "/") + '"' for arg in java_args), encoding="utf-8")
    run(JAVA / "bin" / ("javac" + EXE), "@" + str(argfile))
    with zipfile.ZipFile(work / "classes.jar", "w") as archive:
        for file in sorted(classes.rglob("*.class")):
            archive.write(file, file.relative_to(classes).as_posix())
    run(JAVA / "bin" / ("java" + EXE), "-cp", TOOLS / "lib/d8.jar", "com.android.tools.r8.D8",
        "--release", "--min-api", "26", "--lib", jar, "--output", work, work / "classes.jar")
    with zipfile.ZipFile(work / "base.apk", "a", zipfile.ZIP_DEFLATED) as archive:
        archive.write(work / "classes.dex", "classes.dex")
    run(TOOLS / ("zipalign" + EXE), "-f", "-p", "4", work / "base.apk", work / "aligned.apk")
    # Copy the private files into the temporary ASCII path for apksigner. They are
    # removed with this freshly allocated directory and never copied to release/.
    shutil.copyfile(key, work / "signing.jks")
    shutil.copyfile(password, work / "password.txt")
    run(TOOLS / ("apksigner.bat" if WINDOWS else "apksigner"), "sign", "--ks", work / "signing.jks",
        "--ks-key-alias", "tide", "--ks-pass", "file:" + str(work / "password.txt"),
        "--out", work / "signed.apk", work / "aligned.apk")
    run(TOOLS / ("apksigner.bat" if WINDOWS else "apksigner"), "verify", "--verbose", "--print-certs", work / "signed.apk")
    apk = output / f"Tide-Android-{VERSION}.apk"
    shutil.copyfile(work / "signed.apk", apk)

with zipfile.ZipFile(apk) as archive:
    assert archive.testzip() is None
    assert {"AndroidManifest.xml", "classes.dex", "resources.arsc"}.issubset(archive.namelist())
    assert not any(name.startswith("lib/") for name in archive.namelist()), "Universal Java APK must not include native ABI libraries"
digest = hashlib.sha256(apk.read_bytes()).hexdigest()
(output / "SHA256SUMS.txt").write_text(digest + "  " + apk.name + "\n", encoding="utf-8")
print("APK_READY", apk, apk.stat().st_size, digest, flush=True)
