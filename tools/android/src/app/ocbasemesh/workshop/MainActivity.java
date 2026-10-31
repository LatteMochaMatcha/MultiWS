// OC 白模工坊的安卓外壳（给手机用）。
// 打包好的网页（dist 文件夹）装在安装包的 assets/www 里。这里只有一个铺满屏幕的 WebView，做四件事：
//   1. 网页要的每个文件都从 assets/www 里取（不联网，这个应用也没有联网权限）；
//   2. 网页要存文件（导出的模型、截图、配置）时，替它写进手机的「下载」或「图片」；
//   3. 网页要选文件（载入配置）时，打开系统的文件选择；
//   4. 按返回键时先问网页要不要自己处理（还原放大的视图、取消选中）。
// 打包见 tools/apk.ps1：只用安卓的打包工具和 javac，没有 Gradle，也没有用 AndroidX。
package app.ocbasemesh.workshop;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String TAG = "OcWorkshop";
    // 网页得有个 https 的地址，浏览器内核才肯让它用模块脚本和后台线程。
    // 这个域名是谷歌专门留给「应用自己的文件」用的，不会真的连出去
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    // 存出去的文件都放在「下载」「图片」下面这个名字的文件夹里
    private static final String FOLDER = "OC白模工坊";
    private static final int PICK_FILE = 1;

    private static final Map<String, String> TYPES = new HashMap<>();

    static {
        TYPES.put("html", "text/html");
        TYPES.put("js", "text/javascript");
        TYPES.put("css", "text/css");
        TYPES.put("json", "application/json");
        TYPES.put("svg", "image/svg+xml");
        TYPES.put("png", "image/png");
        TYPES.put("jpg", "image/jpeg");
        TYPES.put("ico", "image/x-icon");
        TYPES.put("wasm", "application/wasm");
    }

    private WebView web;
    /** 网页正等着的「选文件」结果 */
    private ValueCallback<Uri[]> picking;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        // 自己检查用：adb shell am start -n app.ocbasemesh.workshop/.MainActivity --ei w 360 --ei h 590
        // 把页面限制成这么大（单位 dp），在横着的模拟器上也能看竖屏手机的版面。平常打开没有这两个数，页面铺满整屏
        int testWidth = getIntent().getIntExtra("w", 0);
        int testHeight = getIntent().getIntExtra("h", 0);
        if (testWidth > 0 && testHeight > 0) {
            float dp = getResources().getDisplayMetrics().density;
            FrameLayout frame = new FrameLayout(this);
            frame.addView(web, new FrameLayout.LayoutParams(Math.round(testWidth * dp), Math.round(testHeight * dp)));
            setContentView(frame);
        } else {
            setContentView(web);
        }

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        // 设定存在网页自己的存储里，下次打开还在
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                // 页面里别的网址：交给系统浏览器，不在这里面开
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException e) {
                    // 没有能打开它的应用：算了
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (picking != null) picking.onReceiveValue(null);
                picking = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(intent, PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    picking = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                // 网页的报错写进系统日志，出了问题用 adb logcat -s OcWorkshop 看
                Log.println(message.messageLevel() == ConsoleMessage.MessageLevel.ERROR ? Log.ERROR : Log.INFO, TAG,
                        message.message() + "  (" + message.sourceId() + ":" + message.lineNumber() + ")");
                return true;
            }
        });

        web.addJavascriptInterface(new Files(), "OcAndroid");
        // 转屏之类不会重开这个界面；真的被系统重开了就重新载入，设定在网页的存储里，丢不了
        web.loadUrl(HOME);
    }

    /** 网页要的文件：从安装包里的 assets/www 取。别的地址一律不管（没有联网权限，本来也出不去） */
    private WebResourceResponse serve(Uri url) {
        if (!HOST.equals(url.getHost())) return null;
        String path = url.getPath();
        if (path == null || path.isEmpty() || path.equals("/")) path = "/index.html";
        String type = TYPES.get(path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT));
        boolean text = type != null && (type.startsWith("text/") || type.equals("application/json") || type.equals("image/svg+xml"));
        try {
            InputStream file = getAssets().open("www" + path);
            return new WebResourceResponse(type != null ? type : "application/octet-stream", text ? "utf-8" : null, file);
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    Collections.<String, String>emptyMap(), new ByteArrayInputStream(new byte[0]));
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request != PICK_FILE || picking == null) return;
        picking.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
        picking = null;
    }

    @Override
    public void onBackPressed() {
        // 网页放大了 3D 视图、或者选中了部件：返回键先把那个收起来；没有要收的才退出
        web.evaluateJavascript("window.__ocBack ? window.__ocBack() : false", handled -> {
            if (!"true".equals(handled)) finish();
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    /**
     * 网页里的 window.OcAndroid。存一个文件分三步：begin（起名）→ 若干次 write（一段段的内容，base64）→ end。
     * 每一步返回空字符串是成功，否则是出错的原因。图片存进「图片」，相册里看得到；别的存进「下载」。
     */
    private final class Files {
        private Uri target;
        private OutputStream out;

        @JavascriptInterface
        public synchronized String begin(String name) {
            abort();
            try {
                boolean image = name.toLowerCase(Locale.ROOT).endsWith(".png");
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                // 模型文件报成「不认识的类型」，系统才不会给文件名另加后缀
                values.put(MediaStore.MediaColumns.MIME_TYPE,
                        image ? "image/png" : name.endsWith(".json") ? "application/json" : "application/octet-stream");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                        (image ? Environment.DIRECTORY_PICTURES : Environment.DIRECTORY_DOWNLOADS) + "/" + FOLDER);
                // 先标成「还没写完」，写完再亮出来
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);
                ContentResolver resolver = getContentResolver();
                target = resolver.insert(image
                        ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                        : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
                if (target == null) return "系统没有给出存放的位置";
                out = resolver.openOutputStream(target);
                if (out == null) {
                    abort();
                    return "打不开要写的文件";
                }
                return "";
            } catch (Exception e) {
                abort();
                return why(e);
            }
        }

        @JavascriptInterface
        public synchronized String write(String base64) {
            if (out == null) return "还没有开始存文件";
            try {
                out.write(Base64.decode(base64, Base64.DEFAULT));
                return "";
            } catch (Exception e) {
                abort();
                return why(e);
            }
        }

        @JavascriptInterface
        public synchronized String end() {
            if (out == null || target == null) return "还没有开始存文件";
            try {
                out.close();
                out = null;
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(target, values, null, null);
                target = null;
                return "";
            } catch (Exception e) {
                abort();
                return why(e);
            }
        }

        /** 存到一半不存了：把写了一半的那个文件拿掉 */
        @JavascriptInterface
        public synchronized void abort() {
            if (out != null) {
                try {
                    out.close();
                } catch (IOException e) {
                    // 反正要丢掉了
                }
                out = null;
            }
            if (target != null) {
                try {
                    getContentResolver().delete(target, null, null);
                } catch (Exception e) {
                    // 删不掉就留着，不碍事
                }
                target = null;
            }
        }

        private String why(Exception e) {
            Log.e(TAG, "save failed", e);
            String message = e.getMessage();
            return message != null && !message.isEmpty() ? message : e.getClass().getSimpleName();
        }
    }
}
