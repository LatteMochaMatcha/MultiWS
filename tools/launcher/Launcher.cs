// OC 白模工坊的启动器（给没装 Node.js 的人用）。
// 打包好的网页（dist 文件夹）压成 app.zip 嵌在这个 exe 里。双击以后：
//   1. 把 app.zip 读进内存；
//   2. 在本机开一个小网站，只有这台电脑自己能访问（地址是 http://localhost:5210/）；
//   3. 用默认浏览器打开它。
// 关掉这个窗口就退出。不联网，不往硬盘上写东西。
// 编译见 tools/pack.ps1：用的是 Windows 自带的 C# 编译器（csc.exe），所以这里只能写老版本的 C# 语法。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;

[assembly: AssemblyTitle("OC 白模工坊")]
[assembly: AssemblyProduct("OC 白模工坊 v2")]
[assembly: AssemblyDescription("多肢体角色白模生成器")]
// 版本号不写在这里：tools/pack.ps1 照 package.json 生成一个 Version.cs，和这个文件一起编

static class Launcher
{
    // 端口固定，浏览器才认得出是同一个网站，上次的设定才还在。被占了就往后挪
    const int FirstPort = 5210;
    const int Tries = 10;
    // 用来认「这个端口上是不是已经开着一个工坊」
    const string Mark = "oc-basemesh-workshop";

    // 控制台窗口里给人看的字按系统界面语言选：zh 中文，ja 日文，其余都是英文
    static readonly string Lang = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;

    static string Pick(string zh, string ja, string en)
    {
        if (Lang == "zh") return zh;
        if (Lang == "ja") return ja;
        return en;
    }

    static readonly Dictionary<string, byte[]> Files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);

    static readonly Dictionary<string, string> Types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        { ".html", "text/html; charset=utf-8" },
        { ".js", "text/javascript; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" },
        { ".json", "application/json; charset=utf-8" },
        { ".svg", "image/svg+xml" },
        { ".png", "image/png" },
        { ".jpg", "image/jpeg" },
        { ".ico", "image/x-icon" },
        { ".wasm", "application/wasm" },
    };

    static int Main(string[] args)
    {
        // 自己检查用：--no-browser 只开网站，不打开浏览器
        bool browse = Array.IndexOf(args, "--no-browser") < 0;
        try { Console.OutputEncoding = Encoding.UTF8; } catch (IOException) { }
        try { Console.Title = Pick("OC 白模工坊", "OC素体工房", "OC Base Mesh Workshop"); } catch (IOException) { }

        Unpack();

        HttpListener listener = null;
        int port = 0;
        for (int i = 0; i < Tries && listener == null; i++)
        {
            int candidate = FirstPort + i;
            HttpListener attempt = new HttpListener();
            attempt.Prefixes.Add(Address(candidate));
            try
            {
                attempt.Start();
                listener = attempt;
                port = candidate;
            }
            catch (HttpListenerException)
            {
                attempt.Close();
                // 这个端口有人占着。是另一个已经开着的工坊的话，直接打开它就行
                if (IsWorkshop(candidate))
                {
                    Console.WriteLine(string.Format(
                        Pick("工坊已经开着了：{0}", "工房はすでに起動しています：{0}", "The workshop is already running: {0}"),
                        Address(candidate)));
                    if (browse) Browse(candidate);
                    Thread.Sleep(1500);
                    return 0;
                }
            }
        }
        if (listener == null)
        {
            Console.WriteLine(string.Format(
                Pick("没能启动：{0} 到 {1} 这几个端口都被别的程序占着。",
                     "起動できませんでした：ポート {0}～{1} がすべてほかのプログラムに使われています。",
                     "Couldn't start: ports {0} to {1} are all in use by other programs."),
                FirstPort, FirstPort + Tries - 1));
            Console.WriteLine(Pick("关掉别的程序再试一次。按任意键退出。",
                                   "ほかのプログラムを閉じて、もう一度お試しください。何かキーを押すと終了します。",
                                   "Close the other programs and try again. Press any key to exit."));
            try { Console.ReadKey(); } catch (InvalidOperationException) { }
            return 1;
        }

        Thread server = new Thread(delegate() { Serve(listener); });
        server.IsBackground = true;
        server.Start();

        Console.WriteLine();
        Console.WriteLine(Pick("  OC 白模工坊 正在运行", "  OC素体工房が起動しています", "  OC Base Mesh Workshop is running"));
        Console.WriteLine();
        Console.WriteLine(string.Format(
            Pick("  浏览器里的地址： {0}", "  ブラウザで開くアドレス： {0}", "  Address to open in your browser: {0}"),
            Address(port)));
        Console.WriteLine(Pick("  浏览器没有自动打开的话，把上面的地址复制到 Edge 或 Chrome 里。",
                               "  ブラウザが自動で開かないときは、上のアドレスを Edge か Chrome にコピーしてください。",
                               "  If the browser doesn't open by itself, copy the address above into Edge or Chrome."));
        Console.WriteLine();
        Console.WriteLine(Pick("  用的时候不要关这个窗口；用完以后关掉它，就退出了。",
                               "  使っている間は、このウィンドウを閉じないでください。使い終わったら閉じると、終了します。",
                               "  Keep this window open while you use the workshop. Close it when you are done and the program exits."));
        Console.WriteLine();
        if (browse) Browse(port);

        Thread.Sleep(Timeout.Infinite);
        return 0;
    }

    static string Address(int port)
    {
        return "http://localhost:" + port + "/";
    }

    // 把嵌在 exe 里的 app.zip 解到内存里
    static void Unpack()
    {
        using (Stream packed = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.zip"))
        using (ZipArchive zip = new ZipArchive(packed, ZipArchiveMode.Read))
        {
            foreach (ZipArchiveEntry entry in zip.Entries)
            {
                string name = entry.FullName.Replace('\\', '/');
                if (name.EndsWith("/")) continue;
                using (Stream from = entry.Open())
                using (MemoryStream to = new MemoryStream((int)entry.Length))
                {
                    from.CopyTo(to);
                    Files[name] = to.ToArray();
                }
            }
        }
    }

    static bool IsWorkshop(int port)
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Address(port) + "__whoami");
            request.Timeout = 1500;
            request.Proxy = null;
            using (WebResponse response = request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
            {
                return reader.ReadToEnd() == Mark;
            }
        }
        catch (WebException)
        {
            return false;
        }
    }

    static void Browse(int port)
    {
        try
        {
            Process.Start(Address(port));
        }
        catch (Exception)
        {
            // 没有默认浏览器之类的情况：地址已经印在窗口里了，让人自己打开
        }
    }

    static void Serve(HttpListener listener)
    {
        while (listener.IsListening)
        {
            HttpListenerContext context;
            try
            {
                context = listener.GetContext();
            }
            catch (HttpListenerException)
            {
                break;
            }
            ThreadPool.QueueUserWorkItem(delegate { Answer(context); });
        }
    }

    static void Answer(HttpListenerContext context)
    {
        try
        {
            HttpListenerResponse response = context.Response;
            string path = Uri.UnescapeDataString(context.Request.Url.AbsolutePath).TrimStart('/');
            if (path.Length == 0) path = "index.html";

            byte[] body;
            if (path == "__whoami")
            {
                body = Encoding.UTF8.GetBytes(Mark);
                response.ContentType = "text/plain";
            }
            else if (Files.TryGetValue(path, out body))
            {
                string type;
                response.ContentType = Types.TryGetValue(Path.GetExtension(path), out type) ? type : "application/octet-stream";
            }
            else
            {
                body = Encoding.UTF8.GetBytes("404");
                response.StatusCode = 404;
                response.ContentType = "text/plain";
            }
            // 文件就在本机内存里，不用浏览器存一份；换了新版的 exe 也不会看到旧的
            response.Headers["Cache-Control"] = "no-store";
            response.ContentLength64 = body.Length;
            if (context.Request.HttpMethod != "HEAD") response.OutputStream.Write(body, 0, body.Length);
            response.Close();
        }
        catch (Exception)
        {
            // 浏览器中途断开（关了页面、刷新）：这一次请求不用管
        }
    }
}
