// AI 助手的转发：网页里的 AI 助手要连 DeepSeek、Claude 这些服务商，浏览器直接连常被跨域挡住，
// 就把请求发到这个本机小网站的 /__ai/fwd/<http|https>/<主机>/<路径>，这里替它发出去，流式的回答一段段原样交回。
// 规矩和开发服务器上的 tools/ai-forward/plugin.mjs 一样（页面那一头见 src/ai/transport.ts）：
//   - GET /__ai/ping 回一句 oc-ai，页面靠它知道有转发；
//   - 转发要带 X-Shell: 1（和 /__shell/ 一样：别的网站在浏览器里发不出带这种头的跨站请求）；
//   - 只转发到 https，http 只许本机（本机的 Ollama）；不带 cookie、Origin、Referer 出去；
//   - 不记、不存任何内容。钥匙在请求头里，只发给页面指定的那一家。
// 编译见 tools/pack.ps1，只能写老版本的 C# 语法。
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;

static class AiForward
{
    const string Fwd = "/__ai/fwd/";

    static readonly HashSet<string> DropOut = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "Host", "Origin", "Referer", "Cookie", "X-Shell", "Connection", "Content-Length", "Accept-Encoding", "Keep-Alive",
        "Transfer-Encoding", "Upgrade", "TE", "Trailer", "Proxy-Authorization", "Proxy-Connection", "Expect"
    };

    static readonly HashSet<string> DropBack = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "Content-Encoding", "Content-Length", "Transfer-Encoding", "Connection", "Keep-Alive", "Set-Cookie"
    };

    static AiForward()
    {
        // 老的 .NET Framework 默认不开 TLS 1.2、每个网站最多同时两条连接、还会先问一句 100-continue
        try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch (NotSupportedException) { }
        try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)12288; } catch (NotSupportedException) { }
        ServicePointManager.DefaultConnectionLimit = Math.Max(ServicePointManager.DefaultConnectionLimit, 16);
        ServicePointManager.Expect100Continue = false;
    }

    // 是 /__ai/ 下的地址就在这里回完、返回 true；不是返回 false
    public static bool Handle(HttpListenerContext context)
    {
        HttpListenerRequest request = context.Request;
        HttpListenerResponse response = context.Response;
        string raw = request.RawUrl ?? "";
        if (!raw.StartsWith("/__ai/")) return false;
        response.Headers["Cache-Control"] = "no-store";
        if (raw == "/__ai/ping" && request.HttpMethod == "GET")
        {
            Text(response, 200, "text/plain; charset=utf-8", "oc-ai");
            return true;
        }
        if (!raw.StartsWith(Fwd))
        {
            Fail(response, 404, "not found");
            return true;
        }
        if (request.Headers["X-Shell"] != "1")
        {
            Fail(response, 403, "forbidden");
            return true;
        }
        Uri target = TargetOf(raw.Substring(Fwd.Length));
        if (target == null)
        {
            Fail(response, 400, "only https targets (or http on this computer) can be forwarded");
            return true;
        }
        Forward(request, response, target);
        return true;
    }

    // /__ai/fwd/ 后面那段换回服务商的地址：「https/api.deepseek.com/v1/chat/completions」→ https://api.deepseek.com/v1/chat/completions
    public static Uri TargetOf(string rest)
    {
        int slash = rest.IndexOf('/');
        if (slash <= 0) return null;
        string scheme = rest.Substring(0, slash);
        Uri url;
        if (!Uri.TryCreate(scheme + "://" + rest.Substring(slash + 1), UriKind.Absolute, out url)) return null;
        if (scheme == "https" && url.Scheme == "https") return url;
        if (scheme == "http" && url.Scheme == "http" && (url.Host == "localhost" || url.Host == "127.0.0.1" || url.Host == "[::1]")) return url;
        return null;
    }

    static void Forward(HttpListenerRequest request, HttpListenerResponse response, Uri target)
    {
        HttpWebRequest up = (HttpWebRequest)WebRequest.Create(target);
        up.Method = request.HttpMethod;
        up.AllowAutoRedirect = false;
        up.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
        // 模型想得久的时候几分钟才说完
        up.Timeout = 10 * 60 * 1000;
        up.ReadWriteTimeout = 10 * 60 * 1000;
        foreach (string name in request.Headers.AllKeys)
        {
            if (DropOut.Contains(name) || name.StartsWith("Sec-", StringComparison.OrdinalIgnoreCase)) continue;
            string value = request.Headers[name];
            switch (name.ToLowerInvariant())
            {
                case "content-type": up.ContentType = value; break;
                case "accept": up.Accept = value; break;
                case "user-agent": up.UserAgent = value; break;
                default:
                    try { up.Headers[name] = value; }
                    catch (ArgumentException) { }
                    break;
            }
        }
        try
        {
            if (request.HttpMethod != "GET" && request.HttpMethod != "HEAD")
            {
                byte[] body;
                using (MemoryStream copy = new MemoryStream())
                {
                    request.InputStream.CopyTo(copy);
                    body = copy.ToArray();
                }
                up.ContentLength = body.Length;
                using (Stream to = up.GetRequestStream()) to.Write(body, 0, body.Length);
            }
            HttpWebResponse answer;
            try
            {
                answer = (HttpWebResponse)up.GetResponse();
            }
            catch (WebException e)
            {
                // 服务商回了 4xx、5xx：照样把它说的交回去（页面要读里面的报错）
                answer = e.Response as HttpWebResponse;
                if (answer == null)
                {
                    Fail(response, 502, "cannot reach " + target.Host + ": " + e.Message);
                    return;
                }
            }
            using (answer)
            {
                response.StatusCode = (int)answer.StatusCode;
                foreach (string name in answer.Headers.AllKeys)
                {
                    if (DropBack.Contains(name)) continue;
                    if (string.Equals(name, "Content-Type", StringComparison.OrdinalIgnoreCase)) response.ContentType = answer.Headers[name];
                    else
                    {
                        try { response.Headers[name] = answer.Headers[name]; }
                        catch (ArgumentException) { }
                    }
                }
                response.Headers["Cache-Control"] = "no-store";
                response.SendChunked = true;
                using (Stream from = answer.GetResponseStream())
                {
                    byte[] buffer = new byte[8192];
                    int n;
                    while ((n = from.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        response.OutputStream.Write(buffer, 0, n);
                        response.OutputStream.Flush();
                    }
                }
            }
            response.Close();
        }
        catch (Exception e)
        {
            // 页面那边断开了（点了「停」、关了页面），或者连不上：能回就回一句，回不了就算了
            try { Fail(response, 502, "cannot reach " + target.Host + ": " + e.Message); }
            catch (Exception) { }
        }
    }

    static void Fail(HttpListenerResponse response, int status, string message)
    {
        string json = "{\"error\":{\"type\":\"forward_error\",\"message\":\"" + message.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"}}";
        Text(response, status, "application/json; charset=utf-8", json);
    }

    static void Text(HttpListenerResponse response, int status, string type, string text)
    {
        byte[] body = Encoding.UTF8.GetBytes(text);
        response.StatusCode = status;
        response.ContentType = type;
        response.ContentLength64 = body.Length;
        response.OutputStream.Write(body, 0, body.Length);
        response.Close();
    }
}
