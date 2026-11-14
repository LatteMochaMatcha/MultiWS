// AI 助手的转发（网页那一头见 src/ai/transport.ts，exe 外壳的同一件事见 tools/launcher/AiForward.cs）。
// 网页里的 AI 助手要连 DeepSeek、Claude 这些服务商；WebView 拦请求时拿不到请求体，
// 所以网页调 window.OcAi.start(...) 把请求交给这里，用 HttpURLConnection 发出去，
// 回答先报状态和响应头（__ocAi.head），再一段段推回去（__ocAi.chunk，base64），最后 __ocAi.end；出错 __ocAi.fail。
// 只转发到 https（http 只许本机）；不带 cookie、Origin、Referer 出去；不记、不存任何内容。
package app.ocbasemesh.workshop;

import android.app.Activity;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

final class AiBridge {
    private static final Set<String> DROP_OUT = new HashSet<>(Arrays.asList(
            "host", "origin", "referer", "cookie", "x-shell", "connection", "content-length", "accept-encoding",
            "keep-alive", "transfer-encoding", "upgrade", "te", "trailer", "proxy-authorization", "proxy-connection", "expect"));
    private static final Set<String> DROP_BACK = new HashSet<>(Arrays.asList(
            "content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "set-cookie"));

    private final Activity activity;
    private final WebView web;
    /** 正在发的请求：网页点了「停」时断开 */
    private final Map<String, HttpURLConnection> calls = new ConcurrentHashMap<>();
    /** 还没连上就被点了「停」的请求：连上以后马上断开 */
    private final Set<String> cancelled = Collections.newSetFromMap(new ConcurrentHashMap<String, Boolean>());

    AiBridge(Activity activity, WebView web) {
        this.activity = activity;
        this.web = web;
    }

    @JavascriptInterface
    public void start(String id, String url, String method, String headers, String body) {
        new Thread(() -> call(id, url, method, headers, body), "oc-ai-" + id).start();
    }

    @JavascriptInterface
    public void abort(String id) {
        HttpURLConnection c = calls.remove(id);
        if (c != null) c.disconnect();
        else cancelled.add(id);
    }

    private void call(String id, String url, String method, String headers, String body) {
        HttpURLConnection c = null;
        try {
            URL target = new URL(url);
            String host = target.getHost();
            boolean local = "localhost".equals(host) || "127.0.0.1".equals(host);
            if (!"https".equals(target.getProtocol()) && !("http".equals(target.getProtocol()) && local)) {
                push("fail", id, "only https targets (or http on this device) can be forwarded");
                return;
            }
            c = (HttpURLConnection) target.openConnection();
            calls.put(id, c);
            if (cancelled.remove(id)) {
                calls.remove(id);
                return;
            }
            c.setRequestMethod(method);
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(30_000);
            // 模型想得久的时候几分钟才说完
            c.setReadTimeout(10 * 60_000);
            JSONObject h = new JSONObject(headers);
            for (Iterator<String> it = h.keys(); it.hasNext(); ) {
                String name = it.next();
                String lower = name.toLowerCase(Locale.ROOT);
                if (DROP_OUT.contains(lower) || lower.startsWith("sec-")) continue;
                c.setRequestProperty(name, h.optString(name));
            }
            if (body != null && !body.isEmpty() && !"GET".equals(method) && !"HEAD".equals(method)) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int status = c.getResponseCode();
            JSONObject back = new JSONObject();
            for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                if (e.getKey() == null || DROP_BACK.contains(e.getKey().toLowerCase(Locale.ROOT)) || e.getValue().isEmpty()) continue;
                back.put(e.getKey(), e.getValue().get(e.getValue().size() - 1));
            }
            push("head", id, status, back.toString());
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) {
                try (InputStream from = in) {
                    byte[] buffer = new byte[8192];
                    int n;
                    while ((n = from.read(buffer)) > 0) push("chunk", id, Base64.encodeToString(buffer, 0, n, Base64.NO_WRAP));
                }
            }
            push("end", id);
        } catch (Exception e) {
            // 网页点了「停」（abort 断开了连接）就不用再报
            if (calls.containsKey(id)) push("fail", id, e.getClass().getSimpleName() + ": " + e.getMessage());
        } finally {
            calls.remove(id);
            cancelled.remove(id);
            if (c != null) c.disconnect();
        }
    }

    /** 调网页上的 window.__ocAi.<方法>(id, ...)：字符串加引号转义，数字原样。按调用的先后排进界面线程，顺序不乱 */
    private void push(String method, String id, Object... args) {
        StringBuilder js = new StringBuilder("window.__ocAi&&window.__ocAi.").append(method).append('(').append(JSONObject.quote(id));
        for (Object a : args) js.append(',').append(a instanceof String ? JSONObject.quote((String) a) : String.valueOf(a));
        js.append(')');
        String script = js.toString();
        activity.runOnUiThread(() -> web.evaluateJavascript(script, null));
    }
}
