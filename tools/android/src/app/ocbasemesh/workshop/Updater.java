// 软件内自动更新（apk 这边）。方案见 docs/update-plan.md；规则和 exe 那边的 tools/launcher/Updater.cs 一样：
//   1. 检查：从下载站依次读 latest.json 和签名，用打进安装包的公钥核对，对不上就换下一个下载站；
//   2. 下载：只下本机没有的文件（按 sha256 认），下完核对，存在应用自己的 files/update/objects/<sha256>；
//   3. 换版本：全都下好了才写 current.json，网页刷新一下就是新版；
//   4. 退回：新版连着两次打开都没收到「启动成功」，第三次就退回上一版（再不行用安装包自带的）。
// 网页通过 window.OcShell（status / check / download / settings / booted）和这里说话，每个都返回状态的 JSON。
package app.ocbasemesh.workshop;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

final class Updater {
    private static final String TAG = "OcWorkshop";
    /**
     * 外壳的版本（打包时照 tools/update/config.json 的 shell 写进 BuildInfo）。清单的 minShell 比它大，就不用那份清单的网页；
     * 清单里 apk 安装包的 shell 比它大，就提示「安装包有新版本」
     */
    static final int SHELL_VERSION = BuildInfo.SHELL;
    private static final String MANIFEST = "update-manifest.json";
    private static final String CURRENT = "current.json";
    private static final String PREVIOUS = "previous.json";
    private static final String DOWNLOADING = "downloading.json";
    private static final int MAX_UNCONFIRMED = 2;
    private static final long CHECK_EVERY_MS = 20L * 3600 * 1000;

    // ---------- 清单 ----------

    static final class Entry {
        final String path;
        final long size;
        final String sha256;

        Entry(String path, long size, String sha256) {
            this.path = path;
            this.size = size;
            this.sha256 = sha256;
        }
    }

    static final class Manifest {
        private static final Pattern VERSION = Pattern.compile("^\\d+(\\.\\d+){0,3}$");
        private static final Pattern SHA = Pattern.compile("^[0-9a-f]{64}$");

        String version;
        int minShell;
        final Map<String, String> notes = new LinkedHashMap<>();
        final List<Entry> files = new ArrayList<>();
        final Map<String, Entry> byPath = new HashMap<>();
        /** 新的安装包（"exe"、"apk"），可以没有。Entry.path 放安装包里网页的版本号 */
        final Map<String, Entry> installers = new HashMap<>();
        final Map<String, Integer> installerShells = new HashMap<>();

        /** 和 src/update/manifest.ts 的 parseManifest 一样严，有不对的地方就抛异常 */
        static Manifest parse(String text) throws JSONException {
            JSONObject raw = new JSONObject(text);
            if (raw.optInt("format", -1) != 1 || !(raw.opt("format") instanceof Integer)) throw new JSONException("unknown manifest format");
            Manifest m = new Manifest();
            m.version = raw.optString("version", "");
            if (!VERSION.matcher(m.version).matches()) throw new JSONException("bad version");
            Object minShell = raw.opt("minShell");
            if (!(minShell instanceof Integer) || (Integer) minShell < 1) throw new JSONException("bad minShell");
            m.minShell = (Integer) minShell;
            JSONObject notes = raw.optJSONObject("notes");
            if (notes != null) {
                for (String language : new String[] { "zh", "en", "ja" }) {
                    Object note = notes.opt(language);
                    if (note instanceof String) m.notes.put(language, (String) note);
                }
            }
            JSONArray files = raw.optJSONArray("files");
            if (files == null || files.length() == 0) throw new JSONException("no files");
            for (int i = 0; i < files.length(); i++) {
                JSONObject f = files.getJSONObject(i);
                String path = f.optString("path", "");
                if (!safe(path) || path.equals(MANIFEST)) throw new JSONException("unsafe path");
                if (m.byPath.containsKey(path)) throw new JSONException("duplicate path");
                Object size = f.opt("size");
                if (!(size instanceof Integer || size instanceof Long) || ((Number) size).longValue() < 0) throw new JSONException("bad size");
                String sha = f.optString("sha256", "");
                if (!SHA.matcher(sha).matches()) throw new JSONException("bad sha256");
                Entry e = new Entry(path, ((Number) size).longValue(), sha);
                m.files.add(e);
                m.byPath.put(path, e);
            }
            if (!m.byPath.containsKey("index.html")) throw new JSONException("no index.html");
            if (raw.has("installers")) {
                JSONObject installers = raw.optJSONObject("installers");
                if (installers == null) throw new JSONException("bad installers");
                for (String kind : new String[] { "exe", "apk" }) {
                    if (!installers.has(kind)) continue;
                    JSONObject i = installers.getJSONObject(kind);
                    String version = i.optString("version", "");
                    if (!VERSION.matcher(version).matches()) throw new JSONException("bad installer version");
                    Object shell = i.opt("shell");
                    if (!(shell instanceof Integer) || (Integer) shell < 1) throw new JSONException("bad installer shell");
                    Object size = i.opt("size");
                    if (!(size instanceof Integer || size instanceof Long) || ((Number) size).longValue() <= 0) throw new JSONException("bad installer size");
                    String sha = i.optString("sha256", "");
                    if (!SHA.matcher(sha).matches()) throw new JSONException("bad installer sha256");
                    m.installers.put(kind, new Entry(version, ((Number) size).longValue(), sha));
                    m.installerShells.put(kind, (Integer) shell);
                }
            }
            return m;
        }

        private static boolean safe(String path) {
            if (path.isEmpty() || path.startsWith("/") || path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0) return false;
            if (path.length() >= 2 && path.charAt(1) == ':') return false;
            for (String part : path.split("/", -1)) {
                if (part.isEmpty() || part.equals(".") || part.equals("..")) return false;
            }
            return true;
        }

        /** a 新返回正数，一样返回 0；缺的段当 0 */
        static int compare(String a, String b) {
            String[] x = a.split("\\.");
            String[] y = b.split("\\.");
            for (int i = 0; i < Math.max(x.length, y.length); i++) {
                long p = i < x.length ? Long.parseLong(x[i]) : 0;
                long q = i < y.length ? Long.parseLong(y[i]) : 0;
                if (p != q) return p > q ? 1 : -1;
            }
            return 0;
        }
    }

    // ---------- 状态 ----------

    private final Context context;
    private final AssetManager assets;
    private final File stateDir;
    private final File objectsDir;
    private final Object gate = new Object();

    private Manifest builtin;
    private final Map<String, String> builtinPathBySha = new HashMap<>();
    /** 网页现在用的这一版；builtinView 表示用安装包自带的 */
    private volatile Manifest view;
    private volatile boolean builtinView = true;
    private boolean enabled;

    // 存在 state.json 里的
    private boolean autoCheck = true;
    private String skipVersion;
    private long lastCheck;
    private String pendingVersion;
    private int unconfirmed;
    private final List<String> badVersions = new ArrayList<>();

    // 给网页看的
    private String status = "idle";
    private String error;
    private Manifest latest;
    private byte[] latestText;
    private byte[] latestSignature;
    private boolean needsNewShell;
    private long bytesTotal;
    private long bytesDone;
    private boolean busy;

    // 新的安装包（第 5 期）：清单里 apk 安装包的 shell 比这个外壳大时才有
    // none / available / downloading / ready / installing（系统的安装窗口开着）/ error
    private Entry installer;
    private int installerShell;
    private String installerStatus = "none";
    private String installerError;
    private long installerDone;
    private final String started = iso(System.currentTimeMillis());
    private static final String INSTALL_ACTION = "app.ocbasemesh.workshop.INSTALL_STATUS";

    Updater(Context context) {
        this.context = context;
        this.assets = context.getAssets();
        this.stateDir = new File(context.getFilesDir(), "update");
        this.objectsDir = new File(stateDir, "objects");
    }

    /** 打开时调一次：读自带的清单和本机下好的版本，挑出要用的那一版 */
    void init() {
        try {
            builtin = Manifest.parse(new String(readAll(assets.open("www/" + MANIFEST)), StandardCharsets.UTF_8));
        } catch (Exception e) {
            Log.w(TAG, "no builtin update manifest; updates off", e);
            return;
        }
        for (Entry f : builtin.files) builtinPathBySha.putIfAbsent(f.sha256, f.path);
        view = builtin;
        builtinView = true;
        try {
            if (!objectsDir.isDirectory() && !objectsDir.mkdirs()) throw new IOException("cannot create " + objectsDir);
            loadState();
            enabled = true;
            chooseAtStartup();
            resumeDownloading();
            cleanUp();
        } catch (Exception e) {
            enabled = false;
            view = builtin;
            builtinView = true;
            Log.w(TAG, "updates unavailable", e);
        }
    }

    /** 打开时自动查一次（关了、或者 20 小时内查过就不查） */
    void startupCheck() {
        if (!enabled) return;
        synchronized (gate) {
            if (!autoCheck || System.currentTimeMillis() - lastCheck < CHECK_EVERY_MS) return;
        }
        start(() -> check(false));
    }

    // ---------- 网页要的文件 ----------

    /** 按现在用的这一版打开一个文件，没有返回 null */
    InputStream open(String path) {
        Manifest v = view;
        try {
            if (v == null || builtinView) return assets.open("www/" + path);
            Entry e = v.byPath.get(path);
            if (e == null) return null;
            String own = builtinPathBySha.get(e.sha256);
            if (own != null) return assets.open("www/" + own);
            return new FileInputStream(new File(objectsDir, e.sha256));
        } catch (IOException e) {
            return null;
        }
    }

    /** 往 index.html 的 <head> 里加一小段：页面加载完 3 秒内没出脚本错误，就告诉外壳「启动成功」 */
    private static final String PROBE = "<script>(function(){var bad=false;addEventListener('error',function(e){if(e instanceof ErrorEvent)bad=true;});"
            + "addEventListener('load',function(){setTimeout(function(){if(!bad&&window.OcShell)OcShell.booted();},3000);});})();</script>";

    InputStream withProbe(InputStream html) throws IOException {
        String text = new String(readAll(html), StandardCharsets.UTF_8);
        if (enabled) {
            int at = text.toLowerCase(java.util.Locale.ROOT).indexOf("<head>");
            if (at >= 0) text = text.substring(0, at + 6) + PROBE + text.substring(at + 6);
        }
        return new java.io.ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));
    }

    // ---------- window.OcShell ----------

    /** 挂到 WebView 上的 window.OcShell。都在 WebView 的后台线程里被调，不卡界面 */
    final class Bridge {
        @JavascriptInterface
        public String status() {
            return statusJson();
        }

        @JavascriptInterface
        public String check() {
            if (enabled) start(() -> Updater.this.check(true));
            return statusJson();
        }

        @JavascriptInterface
        public String download() {
            if (enabled) start(Updater.this::download);
            return statusJson();
        }

        @JavascriptInterface
        public String settings(String json) {
            try {
                JSONObject raw = new JSONObject(json);
                synchronized (gate) {
                    if (raw.opt("autoCheck") instanceof Boolean) autoCheck = raw.getBoolean("autoCheck");
                    if (raw.has("skip")) skipVersion = raw.isNull("skip") ? null : raw.optString("skip", null);
                    saveState();
                }
            } catch (JSONException e) {
                // 看不懂就不改
            }
            return statusJson();
        }

        @JavascriptInterface
        public String installerDownload() {
            if (enabled) start(Updater.this::installerDownload);
            return statusJson();
        }

        @JavascriptInterface
        public String installerInstall() {
            // 要把整个安装包抄进系统的安装会话：放到后台线程，别卡住网页
            if (enabled) start(Updater.this::installerInstall);
            return statusJson();
        }

        @JavascriptInterface
        public String booted() {
            synchronized (gate) {
                if (pendingVersion != null && !builtinView && view != null && view.version.equals(pendingVersion)) {
                    pendingVersion = null;
                    unconfirmed = 0;
                    saveState();
                }
            }
            return statusJson();
        }
    }

    private String statusJson() {
        synchronized (gate) {
            try {
                JSONObject d = new JSONObject();
                Manifest v = view;
                d.put("shell", SHELL_VERSION);
                d.put("enabled", enabled);
                d.put("version", v != null ? v.version : JSONObject.NULL);
                d.put("builtin", builtin != null ? builtin.version : JSONObject.NULL);
                d.put("usingBuiltin", v == null || builtinView);
                d.put("autoCheck", autoCheck);
                d.put("skip", skipVersion != null ? skipVersion : JSONObject.NULL);
                d.put("lastCheck", lastCheck == 0 ? JSONObject.NULL : iso(lastCheck));
                d.put("status", status);
                d.put("error", error != null ? error : JSONObject.NULL);
                d.put("needsNewShell", needsNewShell);
                if (latest != null) {
                    JSONObject l = new JSONObject();
                    l.put("version", latest.version);
                    l.put("notes", new JSONObject(latest.notes));
                    l.put("bytes", bytesTotal);
                    d.put("latest", l);
                }
                JSONObject p = new JSONObject();
                p.put("done", bytesDone);
                p.put("total", bytesTotal);
                d.put("progress", p);
                d.put("platform", "apk");
                d.put("started", started);
                if (installer != null) {
                    JSONObject i = new JSONObject();
                    i.put("version", installer.path);
                    i.put("shell", installerShell);
                    i.put("bytes", installer.size);
                    i.put("status", installerStatus);
                    i.put("error", installerError != null ? installerError : JSONObject.NULL);
                    i.put("done", installerDone);
                    d.put("installer", i);
                }
                return d.toString();
            } catch (JSONException e) {
                return "{}";
            }
        }
    }

    // ---------- 检查 ----------

    private void start(Runnable work) {
        synchronized (gate) {
            if (busy) return;
            busy = true;
        }
        Thread t = new Thread(() -> {
            try {
                work.run();
            } catch (Exception e) {
                synchronized (gate) {
                    status = "error";
                    error = String.valueOf(e.getMessage());
                }
            } finally {
                synchronized (gate) {
                    busy = false;
                }
            }
        }, "oc-update");
        t.setDaemon(true);
        t.start();
    }

    private void check(boolean byHand) {
        synchronized (gate) {
            status = "checking";
            error = null;
        }
        Manifest found = null;
        byte[] foundText = null;
        byte[] foundSignature = null;
        String lastError = null;
        for (String[] s : BuildInfo.SOURCES) {
            try {
                byte[] text = fetch(s[0] + "latest.json", 8000, 16L << 20);
                byte[] signature = fetch(s[0] + "latest.json.sig", 8000, 64 << 10);
                // 签名对不上：被人换了，或者 GitHub 刚换了清单、缓存里新旧对不上。都当这个地址不能用
                if (!verify(text, signature)) {
                    lastError = "signature mismatch: " + s[0];
                    continue;
                }
                found = Manifest.parse(new String(text, StandardCharsets.UTF_8));
                foundText = text;
                foundSignature = signature;
                break;
            } catch (Exception e) {
                lastError = String.valueOf(e.getMessage());
            }
        }
        synchronized (gate) {
            lastCheck = System.currentTimeMillis();
            saveState();
            if (found == null) {
                status = "offline";
                error = lastError;
                return;
            }
            offerInstaller(found);
            needsNewShell = false;
            latest = null;
            bytesTotal = bytesDone = 0;
            boolean newer = Manifest.compare(found.version, view.version) > 0;
            if (!newer || badVersions.contains(found.version) || (!byHand && found.version.equals(skipVersion))) {
                status = "uptodate";
                return;
            }
            if (found.minShell > SHELL_VERSION) {
                needsNewShell = true;
                status = "uptodate";
                return;
            }
            latest = found;
            latestText = foundText;
            latestSignature = foundSignature;
            bytesTotal = 0;
            for (Entry f : missing(found)) bytesTotal += f.size;
            status = "available";
        }
    }

    // ---------- 新的安装包 ----------

    /** 清单里有比这个外壳新的 apk：记下来给网页提示。下过的不用再下 */
    private void offerInstaller(Manifest found) {
        Entry offered = found.installers.get("apk");
        Integer shell = found.installerShells.get("apk");
        if (offered == null || shell == null || shell <= SHELL_VERSION) {
            if (!"installing".equals(installerStatus)) {
                installer = null;
                installerStatus = "none";
                installerError = null;
            }
            return;
        }
        if (installer != null && installer.sha256.equals(offered.sha256) && !"error".equals(installerStatus)) return;
        installer = offered;
        installerShell = shell;
        installerError = null;
        installerDone = 0;
        File have = new File(objectsDir, offered.sha256);
        installerStatus = have.isFile() && have.length() == offered.size ? "ready" : "available";
    }

    private void installerDownload() {
        Entry target;
        synchronized (gate) {
            if (installer == null || !("available".equals(installerStatus) || "error".equals(installerStatus))) return;
            target = installer;
            installerStatus = "downloading";
            installerError = null;
            installerDone = 0;
        }
        Entry file = new Entry("OC白模工坊.apk", target.size, target.sha256);
        String lastError = null;
        for (String[] s : BuildInfo.SOURCES) {
            try {
                fetchObject(s[0] + s[1] + target.sha256, file, true);
                synchronized (gate) {
                    installerStatus = "ready";
                }
                return;
            } catch (Exception e) {
                lastError = String.valueOf(e.getMessage());
            }
        }
        synchronized (gate) {
            installerStatus = "error";
            installerError = "download failed: " + lastError;
        }
    }

    /**
     * 交给系统装：写进一个 PackageInstaller 的会话再提交，系统弹出确认窗口（要用户点「安装」）。
     * 新包和这个包签名一样（tools/android/sign.keystore），装上去设定都还在；装好以后这个应用会被系统关掉，用户再点开就是新版
     */
    private void installerInstall() {
        File fresh;
        Entry target;
        synchronized (gate) {
            if (installer == null || !"ready".equals(installerStatus)) return;
            target = installer;
            fresh = new File(objectsDir, target.sha256);
            installerStatus = "installing";
            installerError = null;
        }
        try {
            // 装之前再核对一遍，别把下好以后坏掉的文件交出去
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            try (InputStream in = new FileInputStream(fresh)) {
                byte[] buffer = new byte[81920];
                int n;
                while ((n = in.read(buffer)) > 0) hash.update(buffer, 0, n);
            }
            if (fresh.length() != target.size || !hex(hash.digest()).equals(target.sha256)) throw new IOException("downloaded installer is damaged");

            android.content.pm.PackageInstaller packages = context.getPackageManager().getPackageInstaller();
            android.content.pm.PackageInstaller.SessionParams params =
                    new android.content.pm.PackageInstaller.SessionParams(android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(context.getPackageName());
            int id = packages.createSession(params);
            try (android.content.pm.PackageInstaller.Session session = packages.openSession(id)) {
                try (OutputStream out = session.openWrite("base.apk", 0, target.size); InputStream in = new FileInputStream(fresh)) {
                    byte[] buffer = new byte[81920];
                    int n;
                    while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
                    session.fsync(out);
                }
                listenForInstall();
                android.content.Intent result = new android.content.Intent(INSTALL_ACTION).setPackage(context.getPackageName());
                int flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT
                        | (android.os.Build.VERSION.SDK_INT >= 31 ? android.app.PendingIntent.FLAG_MUTABLE : 0);
                session.commit(android.app.PendingIntent.getBroadcast(context, id, result, flags).getIntentSender());
            }
        } catch (Exception e) {
            synchronized (gate) {
                installerStatus = "error";
                installerError = "install failed: " + e.getMessage();
            }
        }
    }

    private boolean listening;

    /** 系统装的结果：要用户确认时打开系统的确认窗口；失败、取消时让网页能重试 */
    private void listenForInstall() {
        if (listening) return;
        listening = true;
        android.content.BroadcastReceiver receiver = new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(Context c, android.content.Intent intent) {
                int code = intent.getIntExtra(android.content.pm.PackageInstaller.EXTRA_STATUS, -999);
                if (code == android.content.pm.PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    android.content.Intent confirm = intent.getParcelableExtra(android.content.Intent.EXTRA_INTENT);
                    if (confirm != null) {
                        confirm.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                        try {
                            context.startActivity(confirm);
                        } catch (Exception e) {
                            synchronized (gate) {
                                installerStatus = "error";
                                installerError = "cannot open the system installer: " + e.getMessage();
                            }
                        }
                    }
                    return;
                }
                if (code == android.content.pm.PackageInstaller.STATUS_SUCCESS) return;
                // 用户点了取消、或者装不上（签名不一样之类）：回到「下好了」，网页能再点一次
                String message = intent.getStringExtra(android.content.pm.PackageInstaller.EXTRA_STATUS_MESSAGE);
                synchronized (gate) {
                    installerStatus = code == android.content.pm.PackageInstaller.STATUS_FAILURE_ABORTED ? "ready" : "error";
                    installerError = code == android.content.pm.PackageInstaller.STATUS_FAILURE_ABORTED ? null : "install failed (" + code + "): " + message;
                }
            }
        };
        android.content.IntentFilter filter = new android.content.IntentFilter(INSTALL_ACTION);
        if (android.os.Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        else context.registerReceiver(receiver, filter);
    }

    private List<Entry> missing(Manifest m) {
        List<Entry> list = new ArrayList<>();
        Set<String> queued = new HashSet<>();
        for (Entry f : m.files) {
            if (queued.contains(f.sha256) || builtinPathBySha.containsKey(f.sha256) || haveObject(f)) continue;
            queued.add(f.sha256);
            list.add(f);
        }
        return list;
    }

    private boolean haveObject(Entry f) {
        File file = new File(objectsDir, f.sha256);
        return file.isFile() && file.length() == f.size;
    }

    // ---------- 下载 ----------

    private void download() {
        Manifest target;
        byte[] text;
        byte[] signature;
        synchronized (gate) {
            if (!"available".equals(status) && !("error".equals(status) && latest != null)) return;
            target = latest;
            text = latestText;
            signature = latestSignature;
            status = "downloading";
            error = null;
            try {
                replace(new File(stateDir, DOWNLOADING + ".sig"), signature);
                replace(new File(stateDir, DOWNLOADING), text);
            } catch (IOException e) {
                status = "error";
                error = String.valueOf(e.getMessage());
                return;
            }
        }
        List<Entry> need = missing(target);
        long total = 0;
        for (Entry f : need) total += f.size;
        synchronized (gate) {
            bytesTotal = total;
            bytesDone = 0;
        }
        // 一个文件下不了也接着下别的：下好的都留着，下次只补没下成的
        String failed = null;
        for (Entry f : need) {
            String lastError = null;
            boolean ok = false;
            for (String[] s : BuildInfo.SOURCES) {
                try {
                    fetchObject(s[0] + s[1] + f.sha256, f);
                    ok = true;
                    break;
                } catch (Exception e) {
                    lastError = String.valueOf(e.getMessage());
                }
            }
            if (!ok && failed == null) failed = f.path + " (" + lastError + ")";
        }
        synchronized (gate) {
            if (failed != null) {
                status = "error";
                error = "download failed: " + failed;
                return;
            }
            try {
                File current = new File(stateDir, CURRENT);
                if (current.isFile()) {
                    replace(new File(stateDir, PREVIOUS), readAll(new FileInputStream(current)));
                    replace(new File(stateDir, PREVIOUS + ".sig"), readAll(new FileInputStream(new File(stateDir, CURRENT + ".sig"))));
                }
                replace(new File(stateDir, CURRENT + ".sig"), signature);
                replace(new File(stateDir, CURRENT), text);
            } catch (IOException e) {
                status = "error";
                error = String.valueOf(e.getMessage());
                return;
            }
            pendingVersion = target.version;
            unconfirmed = 0;
            saveState();
            new File(stateDir, DOWNLOADING).delete();
            new File(stateDir, DOWNLOADING + ".sig").delete();
            view = target;
            builtinView = false;
            status = "ready";
        }
        cleanUp();
    }

    private void fetchObject(String url, Entry f) throws Exception {
        fetchObject(url, f, false);
    }

    /** forInstaller：进度记在安装包那边（installerDone），不算进网页的下载进度 */
    private void fetchObject(String url, Entry f, boolean forInstaller) throws Exception {
        File fin = new File(objectsDir, f.sha256);
        File part = new File(objectsDir, f.sha256 + ".part");
        long counted = 0;
        try {
            HttpURLConnection c = connect(url, 15000);
            c.setReadTimeout(30000);
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buffer = new byte[81920];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    counted += n;
                    if (counted > f.size) throw new IOException("file is larger than the manifest says");
                    hash.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                    synchronized (gate) {
                        if (forInstaller) installerDone += n;
                        else bytesDone += n;
                    }
                }
            } finally {
                c.disconnect();
            }
            if (counted != f.size) throw new IOException("file is smaller than the manifest says");
            if (!hex(hash.digest()).equals(f.sha256)) throw new IOException("sha256 mismatch");
            if (fin.exists()) fin.delete();
            if (!part.renameTo(fin)) throw new IOException("cannot rename " + part);
        } catch (Exception e) {
            synchronized (gate) {
                if (forInstaller) installerDone -= counted;
                else bytesDone -= counted;
            }
            part.delete();
            throw e;
        }
    }

    private static HttpURLConnection connect(String url, int timeout) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(timeout);
        c.setReadTimeout(timeout);
        c.setInstanceFollowRedirects(true);
        // 不带任何能认出用户的东西
        c.setRequestProperty("User-Agent", "OC-Workshop-Updater/" + BuildInfo.VERSION);
        int code = c.getResponseCode();
        if (code != 200) {
            c.disconnect();
            throw new IOException("HTTP " + code + " " + url);
        }
        return c;
    }

    private static byte[] fetch(String url, int timeout, long limit) throws IOException {
        HttpURLConnection c = connect(url, timeout);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            int n;
            while ((n = in.read(buffer)) > 0) {
                out.write(buffer, 0, n);
                if (out.size() > limit) throw new IOException("response too large");
            }
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    private static boolean verify(byte[] text, byte[] signatureFile) {
        try {
            byte[] key = Base64.decode(BuildInfo.PUBLIC_KEY, Base64.DEFAULT);
            PublicKey publicKey = KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(key));
            Signature s = Signature.getInstance("SHA256withRSA");
            s.initVerify(publicKey);
            s.update(text);
            return s.verify(Base64.decode(new String(signatureFile, StandardCharsets.US_ASCII).trim(), Base64.DEFAULT));
        } catch (Exception e) {
            return false;
        }
    }

    // ---------- 启动时挑版本、退回、清理 ----------

    /** 签名对、外壳用得了、文件都在、没被标成打不开。不行返回 null */
    private Manifest loadSaved(String name) {
        try {
            File file = new File(stateDir, name);
            File sig = new File(stateDir, name + ".sig");
            if (!file.isFile() || !sig.isFile()) return null;
            byte[] text = readAll(new FileInputStream(file));
            if (!verify(text, readAll(new FileInputStream(sig)))) return null;
            Manifest m = Manifest.parse(new String(text, StandardCharsets.UTF_8));
            if (m.minShell > SHELL_VERSION || badVersions.contains(m.version)) return null;
            for (Entry f : m.files) {
                if (!builtinPathBySha.containsKey(f.sha256) && !haveObject(f)) return null;
            }
            return m;
        } catch (Exception e) {
            return null;
        }
    }

    private void chooseAtStartup() throws IOException {
        Manifest current = loadSaved(CURRENT);
        if (current != null && current.version.equals(pendingVersion) && Manifest.compare(current.version, builtin.version) > 0) {
            if (unconfirmed >= MAX_UNCONFIRMED) {
                // 这一版连着几次都没启动起来：标成打不开，退回上一版
                badVersions.add(current.version);
                Log.w(TAG, "version " + current.version + " did not start; rolling back");
                rollBack();
                pendingVersion = null;
                unconfirmed = 0;
                current = loadSaved(CURRENT);
            } else {
                unconfirmed++;
            }
            saveState();
        }
        if (current != null && Manifest.compare(current.version, builtin.version) > 0) {
            view = current;
            builtinView = false;
        } else {
            view = builtin;
            builtinView = true;
        }
    }

    private void rollBack() throws IOException {
        File current = new File(stateDir, CURRENT);
        File previous = new File(stateDir, PREVIOUS);
        File previousSig = new File(stateDir, PREVIOUS + ".sig");
        if (previous.isFile() && previousSig.isFile()) {
            replace(new File(stateDir, CURRENT + ".sig"), readAll(new FileInputStream(previousSig)));
            replace(current, readAll(new FileInputStream(previous)));
            previous.delete();
            previousSig.delete();
        } else {
            current.delete();
            new File(stateDir, CURRENT + ".sig").delete();
        }
    }

    private void resumeDownloading() {
        try {
            File file = new File(stateDir, DOWNLOADING);
            File sig = new File(stateDir, DOWNLOADING + ".sig");
            if (!file.isFile() || !sig.isFile()) return;
            byte[] text = readAll(new FileInputStream(file));
            byte[] signature = readAll(new FileInputStream(sig));
            if (!verify(text, signature)) return;
            Manifest m = Manifest.parse(new String(text, StandardCharsets.UTF_8));
            if (m.minShell > SHELL_VERSION || badVersions.contains(m.version) || Manifest.compare(m.version, view.version) <= 0) return;
            latest = m;
            latestText = text;
            latestSignature = signature;
            bytesTotal = 0;
            for (Entry f : missing(m)) bytesTotal += f.size;
            status = "available";
        } catch (Exception e) {
            // 读不了就当没有
        }
    }

    /** 只留 current、previous、下到一半的那版（比现在用的新才算）和刚查到的新版用得到的文件 */
    private void cleanUp() {
        try {
            Set<String> keep = new HashSet<>();
            for (String name : new String[] { CURRENT, PREVIOUS, DOWNLOADING }) {
                File file = new File(stateDir, name);
                if (!file.isFile()) continue;
                try {
                    Manifest m = Manifest.parse(new String(readAll(new FileInputStream(file)), StandardCharsets.UTF_8));
                    if (name.equals(DOWNLOADING) && Manifest.compare(m.version, view.version) <= 0) continue;
                    for (Entry f : m.files) keep.add(f.sha256);
                } catch (Exception e) {
                    // 坏了的清单不算
                }
            }
            synchronized (gate) {
                if (latest != null) for (Entry f : latest.files) keep.add(f.sha256);
                if (installer != null) keep.add(installer.sha256);
                if (busy && "downloading".equals(installerStatus)) return;
                if (busy && "downloading".equals(status)) return;
            }
            File[] files = objectsDir.listFiles();
            if (files == null) return;
            for (File f : files) {
                if (!keep.contains(f.getName())) f.delete();
            }
        } catch (Exception e) {
            // 清不掉下次再清
        }
    }

    // ---------- state.json ----------

    private void loadState() {
        File file = new File(stateDir, "state.json");
        if (!file.isFile()) return;
        try {
            JSONObject raw = new JSONObject(new String(readAll(new FileInputStream(file)), StandardCharsets.UTF_8));
            if (raw.opt("autoCheck") instanceof Boolean) autoCheck = raw.getBoolean("autoCheck");
            skipVersion = raw.isNull("skip") ? null : raw.optString("skip", null);
            lastCheck = raw.optLong("lastCheck", 0);
            pendingVersion = raw.isNull("pending") ? null : raw.optString("pending", null);
            unconfirmed = raw.optInt("unconfirmed", 0);
            JSONArray bad = raw.optJSONArray("bad");
            if (bad != null) for (int i = 0; i < bad.length(); i++) badVersions.add(bad.getString(i));
        } catch (Exception e) {
            // 坏了就当没有
        }
    }

    private void saveState() {
        try {
            JSONObject d = new JSONObject();
            d.put("autoCheck", autoCheck);
            d.put("skip", skipVersion != null ? skipVersion : JSONObject.NULL);
            d.put("lastCheck", lastCheck);
            d.put("pending", pendingVersion != null ? pendingVersion : JSONObject.NULL);
            d.put("unconfirmed", unconfirmed);
            d.put("bad", new JSONArray(badVersions));
            replace(new File(stateDir, "state.json"), d.toString().getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            Log.w(TAG, "cannot save update state", e);
        }
    }

    // ---------- 小工具 ----------

    /** 先写临时文件再换过去：写到一半断电，原来的文件还是好的 */
    private static void replace(File file, byte[] bytes) throws IOException {
        File temp = new File(file.getPath() + ".tmp");
        try (OutputStream out = new FileOutputStream(temp)) {
            out.write(bytes);
        }
        if (!temp.renameTo(file)) {
            // 老一点的系统上目标已存在时改名会失败：先删再改
            file.delete();
            if (!temp.renameTo(file)) throw new IOException("cannot replace " + file);
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        try (InputStream input = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[16384];
            int n;
            while ((n = input.read(buffer)) > 0) out.write(buffer, 0, n);
            return out.toByteArray();
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static String iso(long millis) {
        java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.ROOT);
        f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return f.format(new java.util.Date(millis));
    }
}
