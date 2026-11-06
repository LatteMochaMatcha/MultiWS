// 软件内自动更新（exe 这边）。方案见 docs/update-plan.md，清单的规则和 src/update/manifest.ts 一样。
//
// 外壳自带一份网页（app.zip，里面有 update-manifest.json 记着每个文件的 sha256）。
// 下载站上有更新的清单 latest.json 和它的签名 latest.json.sig：
//   1. 检查：从下载站依次读清单和签名，用编进 exe 的公钥核对签名，对不上就换下一个下载站；
//   2. 下载：只下本机没有的文件（按 sha256 认），每个文件下完核对 sha256，存在 %LOCALAPPDATA%\OC白模工坊\update\objects\<sha256>；
//   3. 换版本：所有文件都下好了，才把清单写成 current.json（先写临时文件再改名），网页刷新一下就是新版；
//   4. 退回：换上新版以后，网页启动成功会告诉外壳一声；连着两次打开都没收到，就退回上一版（再不行就用自带的）。
// 网页通过 /__shell/ 下面几个地址问状态、让外壳检查和下载。
// 编译见 tools/pack.ps1：只能写老版本的 C# 语法（Windows 自带的 csc.exe）。
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

sealed class ManifestFile
{
    public string Path;
    public long Size;
    public string Sha256;
}

sealed class Manifest
{
    public const string FileName = "update-manifest.json";
    const int Format = 1;
    static readonly Regex VersionPattern = new Regex(@"^\d+(\.\d+){0,3}$");
    static readonly Regex ShaPattern = new Regex("^[0-9a-f]{64}$");

    public string Version;
    public int MinShell;
    public Dictionary<string, string> Notes = new Dictionary<string, string>();
    public List<ManifestFile> Files = new List<ManifestFile>();
    public Dictionary<string, ManifestFile> ByPath = new Dictionary<string, ManifestFile>(StringComparer.Ordinal);
    // 新的安装包（"exe"、"apk"），可以没有
    public Dictionary<string, Installer> Installers = new Dictionary<string, Installer>();

    public sealed class Installer
    {
        public string Version;
        public int Shell;
        public long Size;
        public string Sha256;
    }

    // 读一份清单，格式和 src/update/manifest.ts 的 parseManifest 一样严。有不对的地方就抛异常
    public static Manifest Parse(string text)
    {
        Dictionary<string, object> raw = new JavaScriptSerializer { MaxJsonLength = 64 * 1024 * 1024 }.DeserializeObject(text) as Dictionary<string, object>;
        if (raw == null) throw new FormatException("manifest is not an object");
        if (!raw.ContainsKey("format") || !(raw["format"] is int) || (int)raw["format"] != Format) throw new FormatException("unknown manifest format");
        Manifest m = new Manifest();
        m.Version = raw.ContainsKey("version") ? raw["version"] as string : null;
        if (m.Version == null || !VersionPattern.IsMatch(m.Version)) throw new FormatException("bad version");
        if (!raw.ContainsKey("minShell") || !(raw["minShell"] is int) || (int)raw["minShell"] < 1) throw new FormatException("bad minShell");
        m.MinShell = (int)raw["minShell"];
        Dictionary<string, object> notes = raw.ContainsKey("notes") ? raw["notes"] as Dictionary<string, object> : null;
        if (notes != null)
        {
            foreach (string language in new[] { "zh", "en", "ja" })
            {
                if (notes.ContainsKey(language) && notes[language] is string) m.Notes[language] = (string)notes[language];
            }
        }
        object[] files = raw.ContainsKey("files") ? raw["files"] as object[] : null;
        if (files == null || files.Length == 0) throw new FormatException("no files");
        foreach (object item in files)
        {
            Dictionary<string, object> f = item as Dictionary<string, object>;
            if (f == null) throw new FormatException("file entry is not an object");
            ManifestFile file = new ManifestFile();
            file.Path = f.ContainsKey("path") ? f["path"] as string : null;
            if (file.Path == null || !IsSafePath(file.Path) || file.Path == FileName) throw new FormatException("unsafe path");
            if (m.ByPath.ContainsKey(file.Path)) throw new FormatException("duplicate path");
            if (!f.ContainsKey("size") || !(f["size"] is int || f["size"] is long)) throw new FormatException("bad size");
            file.Size = Convert.ToInt64(f["size"]);
            if (file.Size < 0) throw new FormatException("bad size");
            file.Sha256 = f.ContainsKey("sha256") ? f["sha256"] as string : null;
            if (file.Sha256 == null || !ShaPattern.IsMatch(file.Sha256)) throw new FormatException("bad sha256");
            m.Files.Add(file);
            m.ByPath[file.Path] = file;
        }
        if (!m.ByPath.ContainsKey("index.html")) throw new FormatException("no index.html");
        Dictionary<string, object> installers = raw.ContainsKey("installers") ? raw["installers"] as Dictionary<string, object> : null;
        if (raw.ContainsKey("installers") && installers == null) throw new FormatException("bad installers");
        if (installers != null)
        {
            foreach (string kind in new[] { "exe", "apk" })
            {
                if (!installers.ContainsKey(kind)) continue;
                Dictionary<string, object> i = installers[kind] as Dictionary<string, object>;
                if (i == null) throw new FormatException("bad installer");
                Installer installer = new Installer();
                installer.Version = i.ContainsKey("version") ? i["version"] as string : null;
                if (installer.Version == null || !VersionPattern.IsMatch(installer.Version)) throw new FormatException("bad installer version");
                if (!i.ContainsKey("shell") || !(i["shell"] is int) || (int)i["shell"] < 1) throw new FormatException("bad installer shell");
                installer.Shell = (int)i["shell"];
                if (!i.ContainsKey("size") || !(i["size"] is int || i["size"] is long)) throw new FormatException("bad installer size");
                installer.Size = Convert.ToInt64(i["size"]);
                if (installer.Size <= 0) throw new FormatException("bad installer size");
                installer.Sha256 = i.ContainsKey("sha256") ? i["sha256"] as string : null;
                if (installer.Sha256 == null || !ShaPattern.IsMatch(installer.Sha256)) throw new FormatException("bad installer sha256");
                m.Installers[kind] = installer;
            }
        }
        return m;
    }

    static bool IsSafePath(string path)
    {
        if (path.Length == 0 || path.StartsWith("/") || path.IndexOf('\\') >= 0 || path.IndexOf('\0') >= 0) return false;
        if (path.Length >= 2 && path[1] == ':') return false;
        foreach (string part in path.Split('/'))
        {
            if (part.Length == 0 || part == "." || part == "..") return false;
        }
        return true;
    }

    // a 新返回正数，一样返回 0；缺的段当 0
    public static int Compare(string a, string b)
    {
        string[] x = a.Split('.');
        string[] y = b.Split('.');
        for (int i = 0; i < Math.Max(x.Length, y.Length); i++)
        {
            long p = i < x.Length ? long.Parse(x[i]) : 0;
            long q = i < y.Length ? long.Parse(y[i]) : 0;
            if (p != q) return p > q ? 1 : -1;
        }
        return 0;
    }
}

static class Updater
{
    // 外壳的版本（打包时照 tools/update/config.json 的 shell 写进 BuildInfo）。
    // 清单的 minShell 比它大，这个外壳就不用那份清单的网页；清单里 exe 安装包的 shell 比它大，就提示「安装包有新版本」
    public const int ShellVersion = BuildInfo.Shell;
    const string CurrentName = "current.json";
    const string PreviousName = "previous.json";
    const string DownloadingName = "downloading.json";
    // 连着这么多次打开新版都没收到「启动成功」，就退回
    const int MaxUnconfirmed = 2;
    // 打开时自动检查，两次之间至少隔这么久
    static readonly TimeSpan CheckEvery = TimeSpan.FromHours(20);

    sealed class Source
    {
        public string Base;
        public string Objects;
    }

    // 网页现在用的这一版：哪个路径取哪份内容。换版本时整个换掉，读的时候不用加锁
    sealed class View
    {
        public Manifest Manifest;
        public bool Builtin;
    }

    static readonly object Gate = new object();
    static Dictionary<string, byte[]> builtinFiles;
    static Manifest builtin;
    static readonly Dictionary<string, string> builtinPathBySha = new Dictionary<string, string>(StringComparer.Ordinal);
    static volatile View view;
    static string stateDir;
    static string objectsDir;
    static List<Source> sources = new List<Source>();
    static bool enabled;

    // 存在 state.json 里的东西
    static bool autoCheck = true;
    static string skipVersion;
    static DateTime lastCheck = DateTime.MinValue;
    static string pendingVersion;
    static int unconfirmed;
    static List<string> badVersions = new List<string>();

    // 给网页看的状态
    static string status = "idle";
    static string error;
    static Manifest latest;
    static byte[] latestText;
    static byte[] latestSignature;
    static bool needsNewShell;
    static long bytesTotal;
    static long bytesDone;
    static bool busy;

    // 新的安装包（第 5 期）：下载站的清单里 exe 安装包的 shell 比这个外壳大时才有
    // none 没有、available 可以下、downloading 正在下、ready 下好了、installing 正在换（马上重启）、error 出错
    static Manifest.Installer installer;
    static string installerStatus = "none";
    static string installerError;
    static long installerDone;
    static string[] launchArgs = new string[0];
    static readonly string Started = DateTime.UtcNow.ToString("o");

    // 测试、换安装包重启时 Launcher 把命令行参数交过来，重启的新外壳照样用
    public static void SetLaunchArgs(string[] args)
    {
        launchArgs = args;
    }

    public static bool Enabled { get { return enabled; } }

    // 启动时调一次：读自带的清单和本机下好的版本，挑出要用的那一版
    public static void Init(Dictionary<string, byte[]> files, string stateOverride)
    {
        builtinFiles = files;
        byte[] own;
        if (!files.TryGetValue(Manifest.FileName, out own)) return;
        try { builtin = Manifest.Parse(Encoding.UTF8.GetString(own)); }
        catch (Exception) { return; }
        foreach (ManifestFile f in builtin.Files)
        {
            if (!builtinPathBySha.ContainsKey(f.Sha256) && files.ContainsKey(f.Path)) builtinPathBySha[f.Sha256] = f.Path;
        }
        view = new View { Manifest = builtin, Builtin = true };

        // 连 GitHub、R2 要 TLS 1.2；老的 .NET Framework 默认不开
        try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch (NotSupportedException) { }
        foreach (string[] s in BuildInfo.Sources) sources.Add(new Source { Base = s[0], Objects = s[1] });

        try
        {
            stateDir = stateOverride ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Path.Combine("OC白模工坊", "update"));
            objectsDir = Path.Combine(stateDir, "objects");
            Directory.CreateDirectory(objectsDir);
            LoadState();
            enabled = true;
            ChooseAtStartup();
            ResumeDownloading();
            CleanUp();
        }
        catch (Exception e)
        {
            // 本机目录写不了之类：照样用自带的网页，只是不能更新
            enabled = false;
            view = new View { Manifest = builtin, Builtin = true };
            Log("更新功能没开起来：" + e.Message, "アップデート機能を開始できませんでした：" + e.Message, "Updates are unavailable: " + e.Message);
        }
    }

    // 打开时自动查一次（设置里关了、或者不到 20 小时前刚查过就不查）。在后台线程里跑
    public static void StartupCheck()
    {
        if (!enabled) return;
        lock (Gate)
        {
            if (!autoCheck || DateTime.UtcNow - lastCheck < CheckEvery) return;
        }
        Start(delegate { Check(false); });
    }

    // ---------- 网页要的文件 ----------

    // 按现在用的这一版取文件，没有返回 null
    public static byte[] Resolve(string path)
    {
        View v = view;
        if (v == null || v.Builtin)
        {
            byte[] body;
            return builtinFiles.TryGetValue(path, out body) ? body : null;
        }
        ManifestFile file;
        if (!v.Manifest.ByPath.TryGetValue(path, out file)) return null;
        string own;
        if (builtinPathBySha.TryGetValue(file.Sha256, out own)) return builtinFiles[own];
        try { return File.ReadAllBytes(Path.Combine(objectsDir, file.Sha256)); }
        catch (IOException) { return null; }
    }

    // 往 index.html 里加一小段：页面加载完 3 秒内没出脚本错误，就告诉外壳「启动成功」
    const string BootProbe = "<script>(function(){var bad=false;addEventListener('error',function(e){if(e instanceof ErrorEvent)bad=true;});" +
        "addEventListener('load',function(){setTimeout(function(){if(bad)return;var x=new XMLHttpRequest();x.open('POST','/__shell/booted');" +
        "x.setRequestHeader('X-Shell','1');x.send();},3000);});})();</script>";

    public static byte[] AddBootProbe(byte[] html)
    {
        if (!enabled) return html;
        string text = Encoding.UTF8.GetString(html);
        int at = text.IndexOf("<head>", StringComparison.OrdinalIgnoreCase);
        if (at < 0) return html;
        return Encoding.UTF8.GetBytes(text.Insert(at + "<head>".Length, BootProbe));
    }

    // ---------- /__shell/ 下的接口 ----------

    // 返回 null 表示不是这里的地址
    public static byte[] Handle(string path, HttpListenerRequest request, HttpListenerResponse response)
    {
        if (!path.StartsWith("__shell/")) return null;
        string what = path.Substring("__shell/".Length);
        response.ContentType = "application/json; charset=utf-8";
        if (what == "status" && request.HttpMethod == "GET") return Json(Status());
        if (request.HttpMethod != "POST" || request.Headers["X-Shell"] != "1")
        {
            // 要带自定义的请求头：别的网站在浏览器里发不出这种请求（跨站会被浏览器拦下），就动不了这里
            response.StatusCode = 403;
            return Json(Message("forbidden"));
        }
        if (!enabled)
        {
            response.StatusCode = 409;
            return Json(Message("updates are unavailable"));
        }
        switch (what)
        {
            case "check":
                Start(delegate { Check(true); });
                return Json(Status());
            case "download":
                Start(Download);
                return Json(Status());
            case "booted":
                Booted();
                return Json(Status());
            case "settings":
                Settings(ReadBody(request));
                return Json(Status());
            case "installer/download":
                Start(InstallerDownload);
                return Json(Status());
            case "installer/install":
                InstallerInstall();
                return Json(Status());
        }
        response.StatusCode = 404;
        return Json(Message("unknown"));
    }

    static Dictionary<string, object> Message(string text)
    {
        Dictionary<string, object> d = new Dictionary<string, object>();
        d["error"] = text;
        return d;
    }

    static string ReadBody(HttpListenerRequest request)
    {
        using (StreamReader reader = new StreamReader(request.InputStream, Encoding.UTF8)) return reader.ReadToEnd();
    }

    static byte[] Json(object value)
    {
        return Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(value));
    }

    static Dictionary<string, object> Status()
    {
        lock (Gate)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            View v = view;
            d["shell"] = ShellVersion;
            d["enabled"] = enabled;
            d["version"] = v != null ? v.Manifest.Version : null;
            d["builtin"] = builtin != null ? builtin.Version : null;
            d["usingBuiltin"] = v == null || v.Builtin;
            d["autoCheck"] = autoCheck;
            d["skip"] = skipVersion;
            d["lastCheck"] = lastCheck == DateTime.MinValue ? null : lastCheck.ToString("o");
            // idle 没查过、checking 正在查、uptodate 已是最新、available 有新版、downloading 正在下、ready 下好了（刷新页面就是新版）、offline 连不上、error 出错
            d["status"] = status;
            d["error"] = error;
            d["needsNewShell"] = needsNewShell;
            if (latest != null)
            {
                Dictionary<string, object> l = new Dictionary<string, object>();
                l["version"] = latest.Version;
                l["notes"] = latest.Notes;
                l["bytes"] = bytesTotal;
                d["latest"] = l;
            }
            Dictionary<string, object> p = new Dictionary<string, object>();
            p["done"] = bytesDone;
            p["total"] = bytesTotal;
            d["progress"] = p;
            d["platform"] = "exe";
            // 外壳这次是什么时候开的：换安装包重启以后会变，网页看到变了就刷新
            d["started"] = Started;
            if (installer != null)
            {
                Dictionary<string, object> i = new Dictionary<string, object>();
                i["version"] = installer.Version;
                i["shell"] = installer.Shell;
                i["bytes"] = installer.Size;
                i["status"] = installerStatus;
                i["error"] = installerError;
                i["done"] = installerDone;
                d["installer"] = i;
            }
            return d;
        }
    }

    static void Settings(string body)
    {
        Dictionary<string, object> raw;
        try { raw = new JavaScriptSerializer().DeserializeObject(body) as Dictionary<string, object>; }
        catch (Exception) { return; }
        if (raw == null) return;
        lock (Gate)
        {
            if (raw.ContainsKey("autoCheck") && raw["autoCheck"] is bool) autoCheck = (bool)raw["autoCheck"];
            if (raw.ContainsKey("skip")) skipVersion = raw["skip"] as string;
            SaveState();
        }
    }

    static void Booted()
    {
        lock (Gate)
        {
            View v = view;
            if (pendingVersion != null && v != null && !v.Builtin && v.Manifest.Version == pendingVersion)
            {
                pendingVersion = null;
                unconfirmed = 0;
                SaveState();
            }
        }
    }

    // ---------- 检查 ----------

    static void Start(ThreadStart work)
    {
        lock (Gate)
        {
            if (busy) return;
            busy = true;
        }
        Thread t = new Thread(delegate()
        {
            try { work(); }
            catch (Exception e) { lock (Gate) { status = "error"; error = e.Message; } }
            finally { lock (Gate) { busy = false; } }
        });
        t.IsBackground = true;
        t.Start();
    }

    static void Check(bool byHand)
    {
        lock (Gate) { status = "checking"; error = null; }
        Manifest found = null;
        byte[] foundText = null, foundSignature = null;
        string lastError = null;
        foreach (Source s in sources)
        {
            try
            {
                byte[] text = Fetch(s.Base + "latest.json", 8000, 16 * 1024 * 1024);
                byte[] signature = Fetch(s.Base + "latest.json.sig", 8000, 64 * 1024);
                // 签名对不上：可能是被人换了，也可能是 GitHub 刚换了清单、缓存里新旧对不上。都当这个地址不能用，试下一个
                if (!Verify(text, signature)) { lastError = "signature mismatch: " + s.Base; continue; }
                found = Manifest.Parse(Encoding.UTF8.GetString(text));
                foundText = text;
                foundSignature = signature;
                break;
            }
            catch (Exception e) { lastError = e.Message; }
        }

        lock (Gate)
        {
            lastCheck = DateTime.UtcNow;
            SaveState();
            if (found == null)
            {
                status = "offline";
                error = lastError;
                return;
            }
            View v = view;
            OfferInstaller(found);
            needsNewShell = false;
            latest = null;
            bytesTotal = bytesDone = 0;
            bool newer = Manifest.Compare(found.Version, v.Manifest.Version) > 0;
            if (!newer || badVersions.Contains(found.Version) || (!byHand && found.Version == skipVersion))
            {
                status = "uptodate";
                return;
            }
            if (found.MinShell > ShellVersion)
            {
                // 新版要更新的外壳才用得了：这个 exe 收不到，要重新下载安装包
                needsNewShell = true;
                status = "uptodate";
                return;
            }
            latest = found;
            latestText = foundText;
            latestSignature = foundSignature;
            bytesTotal = 0;
            foreach (ManifestFile f in Missing(found)) bytesTotal += f.Size;
            status = "available";
        }
        Log("有新版本 " + found.Version + "（约 " + Mb(bytesTotal) + "）",
            "新しいバージョン " + found.Version + " があります（約 " + Mb(bytesTotal) + "）",
            "A new version is available: " + found.Version + " (about " + Mb(bytesTotal) + ")");
    }

    // 清单里有比这个外壳新的 exe 安装包：记下来给网页提示。下过的不用再下（在 objects 里、大小对）
    static void OfferInstaller(Manifest found)
    {
        Manifest.Installer offered;
        if (!found.Installers.TryGetValue("exe", out offered) || offered.Shell <= ShellVersion)
        {
            if (installerStatus != "installing") { installer = null; installerStatus = "none"; installerError = null; }
            return;
        }
        if (installer != null && installer.Sha256 == offered.Sha256 && installerStatus != "error") return;
        installer = offered;
        installerError = null;
        installerDone = 0;
        FileInfo have = new FileInfo(Path.Combine(objectsDir, offered.Sha256));
        installerStatus = have.Exists && have.Length == offered.Size ? "ready" : "available";
        Log("安装包有新版本 " + offered.Version, "インストーラーの新しいバージョン " + offered.Version + " があります",
            "A new installer is available: " + offered.Version);
    }

    // 下载新的 exe：和网页的文件一样按 sha256 核对，存在 objects 里
    static void InstallerDownload()
    {
        Manifest.Installer target;
        lock (Gate)
        {
            if (installer == null || (installerStatus != "available" && installerStatus != "error")) return;
            target = installer;
            installerStatus = "downloading";
            installerError = null;
            installerDone = 0;
        }
        ManifestFile file = new ManifestFile { Path = "OC白模工坊.exe", Size = target.Size, Sha256 = target.Sha256 };
        string lastError = null;
        foreach (Source s in sources)
        {
            try
            {
                FetchObject(s.Base + s.Objects + target.Sha256, file, true);
                lock (Gate) { installerStatus = "ready"; }
                return;
            }
            catch (Exception e) { lastError = e.Message; }
        }
        lock (Gate) { installerStatus = "error"; installerError = "download failed: " + lastError; }
    }

    // 换上新的 exe：自己改名成 .old，新的放到原来的位置，用同样的参数开它，然后自己退出。
    // 新的 exe 等这个进程退出了才占端口（--wait-pid），再把 .old 删掉。网页看到外壳的 started 变了就刷新
    static void InstallerInstall()
    {
        lock (Gate)
        {
            if (installer == null || installerStatus != "ready") return;
            string exe = System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName;
            string old = exe + ".old";
            string fresh = Path.Combine(objectsDir, installer.Sha256);
            try
            {
                // 换之前再核对一遍：下好以后在本机放了一阵，别换上一个坏掉的
                using (FileStream f = File.OpenRead(fresh))
                using (SHA256 hash = SHA256.Create())
                {
                    if (f.Length != installer.Size || Hex(hash.ComputeHash(f)) != installer.Sha256) throw new IOException("downloaded installer is damaged");
                }
                if (File.Exists(old)) File.Delete(old);
                File.Move(exe, old);
                try { File.Copy(fresh, exe); }
                catch (Exception)
                {
                    File.Move(old, exe);
                    throw;
                }
            }
            catch (Exception e)
            {
                installerStatus = "error";
                installerError = "cannot replace the exe: " + e.Message;
                return;
            }

            List<string> args = new List<string>();
            for (int i = 0; i < launchArgs.Length; i++)
            {
                if (launchArgs[i] == "--wait-pid") { i++; continue; }
                if (launchArgs[i] == "--no-browser") continue;
                args.Add(launchArgs[i].IndexOf(' ') >= 0 ? "\"" + launchArgs[i] + "\"" : launchArgs[i]);
            }
            // 页面本来就开着，新的外壳不用再开浏览器
            args.Add("--no-browser");
            args.Add("--wait-pid");
            args.Add(System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
            try
            {
                System.Diagnostics.ProcessStartInfo start = new System.Diagnostics.ProcessStartInfo(exe, string.Join(" ", args.ToArray()));
                start.UseShellExecute = true;
                start.WorkingDirectory = Path.GetDirectoryName(exe);
                System.Diagnostics.Process.Start(start);
            }
            catch (Exception e)
            {
                // 新的开不起来：换回旧的，照常用
                try
                {
                    File.Delete(exe);
                    File.Move(old, exe);
                }
                catch (Exception) { }
                installerStatus = "error";
                installerError = "cannot start the new exe: " + e.Message;
                return;
            }
            installerStatus = "installing";
        }
        Log("正在换上新的安装包，工坊会自己重新打开", "新しいインストーラーに切り替えています。工房は自動でもう一度開きます",
            "Switching to the new installer; the workshop will reopen by itself");
        // 先让这次请求回给网页，再退出
        Thread quit = new Thread(delegate() { Thread.Sleep(800); Environment.Exit(0); });
        quit.IsBackground = false;
        quit.Start();
    }

    // 换安装包重启：等旧的进程退出（它占着端口），再删掉旧的 exe
    public static void AfterReplace(string[] args)
    {
        int at = Array.IndexOf(args, "--wait-pid");
        if (at < 0 || at + 1 >= args.Length) return;
        int pid;
        if (!int.TryParse(args[at + 1], out pid)) return;
        try { System.Diagnostics.Process.GetProcessById(pid).WaitForExit(15000); }
        catch (ArgumentException) { }
        string old = System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName + ".old";
        for (int i = 0; i < 10 && File.Exists(old); i++)
        {
            try { File.Delete(old); }
            catch (Exception) { Thread.Sleep(300); }
        }
    }

    // 本机还没有的文件（同一份内容只算一次）
    static List<ManifestFile> Missing(Manifest m)
    {
        List<ManifestFile> list = new List<ManifestFile>();
        HashSet<string> queued = new HashSet<string>(StringComparer.Ordinal);
        foreach (ManifestFile f in m.Files)
        {
            if (queued.Contains(f.Sha256) || builtinPathBySha.ContainsKey(f.Sha256) || HaveObject(f)) continue;
            queued.Add(f.Sha256);
            list.Add(f);
        }
        return list;
    }

    static bool HaveObject(ManifestFile f)
    {
        FileInfo info = new FileInfo(Path.Combine(objectsDir, f.Sha256));
        return info.Exists && info.Length == f.Size;
    }

    // ---------- 下载 ----------

    static void Download()
    {
        Manifest target;
        byte[] text, signature;
        lock (Gate)
        {
            if (status != "available" && !(status == "error" && latest != null)) return;
            target = latest;
            text = latestText;
            signature = latestSignature;
            status = "downloading";
            error = null;
            // 记下正在下的是哪一版：下到一半关了，下次打开清理时不会把已经下好的文件删掉，也能接着提示「有新版」
            Replace(Path.Combine(stateDir, DownloadingName + ".sig"), signature);
            Replace(Path.Combine(stateDir, DownloadingName), text);
        }
        List<ManifestFile> missing = Missing(target);
        long total = 0;
        foreach (ManifestFile f in missing) total += f.Size;
        lock (Gate) { bytesTotal = total; bytesDone = 0; }

        // 一个文件下不了也接着下别的：下好的都留着，下次只补没下成的
        string failed = null;
        foreach (ManifestFile f in missing)
        {
            string lastError = null;
            bool ok = false;
            foreach (Source s in sources)
            {
                try
                {
                    FetchObject(s.Base + s.Objects + f.Sha256, f);
                    ok = true;
                    break;
                }
                catch (Exception e) { lastError = e.Message; }
            }
            if (!ok && failed == null) failed = f.Path + " (" + lastError + ")";
        }
        if (failed != null)
        {
            lock (Gate) { status = "error"; error = "download failed: " + failed; }
            Log("下载没完成：" + failed, "ダウンロードが完了しませんでした：" + failed, "Download did not finish: " + failed);
            return;
        }

        lock (Gate)
        {
            // 全都下好了才换：上一版留着，退回时用
            string current = Path.Combine(stateDir, CurrentName);
            if (File.Exists(current))
            {
                Replace(Path.Combine(stateDir, PreviousName), File.ReadAllBytes(current));
                Replace(Path.Combine(stateDir, PreviousName + ".sig"), File.ReadAllBytes(current + ".sig"));
            }
            Replace(current + ".sig", signature);
            Replace(current, text);
            pendingVersion = target.Version;
            unconfirmed = 0;
            SaveState();
            File.Delete(Path.Combine(stateDir, DownloadingName));
            File.Delete(Path.Combine(stateDir, DownloadingName + ".sig"));
            view = new View { Manifest = target, Builtin = false };
            status = "ready";
        }
        Log("新版本 " + target.Version + " 下好了，刷新页面就能用", "新しいバージョン " + target.Version + " の準備ができました。ページを再読み込みすると使えます",
            "Version " + target.Version + " is ready. Reload the page to use it");
        CleanUp();
    }

    // 下一个文件：先写 .part，边下边算 sha256，对上了才改成正式的名字
    static void FetchObject(string url, ManifestFile f)
    {
        FetchObject(url, f, false);
    }

    // forInstaller：进度记在安装包那边（installerDone），不算进网页的下载进度
    static void FetchObject(string url, ManifestFile f, bool forInstaller)
    {
        string final = Path.Combine(objectsDir, f.Sha256);
        string part = final + ".part";
        long counted = 0;
        try
        {
            HttpWebRequest request = Request(url, 15000);
            request.ReadWriteTimeout = 30000;
            using (WebResponse response = request.GetResponse())
            using (Stream from = response.GetResponseStream())
            using (FileStream to = new FileStream(part, FileMode.Create, FileAccess.Write))
            using (SHA256 hash = SHA256.Create())
            {
                byte[] buffer = new byte[81920];
                int n;
                while ((n = from.Read(buffer, 0, buffer.Length)) > 0)
                {
                    counted += n;
                    if (counted > f.Size) throw new IOException("file is larger than the manifest says");
                    hash.TransformBlock(buffer, 0, n, null, 0);
                    to.Write(buffer, 0, n);
                    lock (Gate) { if (forInstaller) installerDone += n; else bytesDone += n; }
                }
                hash.TransformFinalBlock(buffer, 0, 0);
                if (counted != f.Size) throw new IOException("file is smaller than the manifest says");
                if (Hex(hash.Hash) != f.Sha256) throw new IOException("sha256 mismatch");
            }
            if (File.Exists(final)) File.Delete(final);
            File.Move(part, final);
        }
        catch (Exception)
        {
            lock (Gate) { if (forInstaller) installerDone -= counted; else bytesDone -= counted; }
            try { File.Delete(part); } catch (IOException) { }
            throw;
        }
    }

    static HttpWebRequest Request(string url, int timeout)
    {
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
        request.Timeout = timeout;
        request.ReadWriteTimeout = timeout;
        request.AllowAutoRedirect = true;
        request.UserAgent = "OC-Workshop-Updater/" + BuildInfo.Version;
        // 不带任何能认出用户的东西
        return request;
    }

    static byte[] Fetch(string url, int timeout, long limit)
    {
        HttpWebRequest request = Request(url, timeout);
        using (WebResponse response = request.GetResponse())
        using (Stream from = response.GetResponseStream())
        using (MemoryStream to = new MemoryStream())
        {
            byte[] buffer = new byte[16384];
            int n;
            while ((n = from.Read(buffer, 0, buffer.Length)) > 0)
            {
                to.Write(buffer, 0, n);
                if (to.Length > limit) throw new IOException("response too large");
            }
            return to.ToArray();
        }
    }

    static bool Verify(byte[] text, byte[] signatureFile)
    {
        try
        {
            byte[] signature = Convert.FromBase64String(Encoding.ASCII.GetString(signatureFile).Trim());
            using (RSACryptoServiceProvider rsa = new RSACryptoServiceProvider())
            {
                rsa.FromXmlString(BuildInfo.PublicKeyXml);
                return rsa.VerifyData(text, "SHA256", signature);
            }
        }
        catch (Exception) { return false; }
    }

    // ---------- 启动时挑版本、退回、清理 ----------

    // 读 current.json 或 previous.json：签名要对、外壳要用得了、文件都在、没被标成打不开。不行返回 null
    static Manifest LoadSaved(string name)
    {
        try
        {
            string path = Path.Combine(stateDir, name);
            if (!File.Exists(path) || !File.Exists(path + ".sig")) return null;
            byte[] text = File.ReadAllBytes(path);
            if (!Verify(text, File.ReadAllBytes(path + ".sig"))) return null;
            Manifest m = Manifest.Parse(Encoding.UTF8.GetString(text));
            if (m.MinShell > ShellVersion || badVersions.Contains(m.Version)) return null;
            foreach (ManifestFile f in m.Files)
            {
                if (!builtinPathBySha.ContainsKey(f.Sha256) && !HaveObject(f)) return null;
            }
            return m;
        }
        catch (Exception) { return null; }
    }

    static void ChooseAtStartup()
    {
        Manifest current = LoadSaved(CurrentName);
        if (current != null && current.Version == pendingVersion && Manifest.Compare(current.Version, builtin.Version) > 0)
        {
            if (unconfirmed >= MaxUnconfirmed)
            {
                // 这一版连着几次都没启动起来：标成打不开，退回上一版
                badVersions.Add(current.Version);
                Log("新版本 " + current.Version + " 打不开，退回上一版", "新しいバージョン " + current.Version + " が起動しなかったので、前のバージョンに戻します",
                    "Version " + current.Version + " did not start; going back to the previous version");
                RollBack();
                pendingVersion = null;
                unconfirmed = 0;
                current = LoadSaved(CurrentName);
            }
            else
            {
                unconfirmed++;
            }
            SaveState();
        }
        if (current != null && Manifest.Compare(current.Version, builtin.Version) > 0) view = new View { Manifest = current, Builtin = false };
        else view = new View { Manifest = builtin, Builtin = true };
    }

    // 上次下到一半的那版：签名还对、比现在用的新、外壳用得了，就接着提示「有新版」，点了只补没下完的
    static void ResumeDownloading()
    {
        try
        {
            string path = Path.Combine(stateDir, DownloadingName);
            if (!File.Exists(path) || !File.Exists(path + ".sig")) return;
            byte[] text = File.ReadAllBytes(path);
            byte[] signature = File.ReadAllBytes(path + ".sig");
            if (!Verify(text, signature)) return;
            Manifest m = Manifest.Parse(Encoding.UTF8.GetString(text));
            if (m.MinShell > ShellVersion || badVersions.Contains(m.Version) || Manifest.Compare(m.Version, view.Manifest.Version) <= 0) return;
            latest = m;
            latestText = text;
            latestSignature = signature;
            bytesTotal = 0;
            foreach (ManifestFile f in Missing(m)) bytesTotal += f.Size;
            status = "available";
        }
        catch (Exception) { }
    }

    // previous 挪回 current；没有 previous 就删掉 current（用自带的）
    static void RollBack()
    {
        string current = Path.Combine(stateDir, CurrentName);
        string previous = Path.Combine(stateDir, PreviousName);
        if (File.Exists(previous) && File.Exists(previous + ".sig"))
        {
            Replace(current + ".sig", File.ReadAllBytes(previous + ".sig"));
            Replace(current, File.ReadAllBytes(previous));
            File.Delete(previous);
            File.Delete(previous + ".sig");
        }
        else
        {
            if (File.Exists(current)) File.Delete(current);
            if (File.Exists(current + ".sig")) File.Delete(current + ".sig");
        }
    }

    // 只留 current、previous、下到一半的那版（比现在用的新才算）和刚查到的新版用得到的文件；下到一半的 .part 都删掉
    static void CleanUp()
    {
        try
        {
            HashSet<string> keep = new HashSet<string>(StringComparer.Ordinal);
            foreach (string name in new[] { CurrentName, PreviousName, DownloadingName })
            {
                string path = Path.Combine(stateDir, name);
                if (!File.Exists(path)) continue;
                try
                {
                    Manifest m = Manifest.Parse(File.ReadAllText(path, Encoding.UTF8));
                    if (name == DownloadingName && Manifest.Compare(m.Version, view.Manifest.Version) <= 0) continue;
                    foreach (ManifestFile f in m.Files) keep.Add(f.Sha256);
                }
                catch (Exception) { }
            }
            lock (Gate)
            {
                if (latest != null) foreach (ManifestFile f in latest.Files) keep.Add(f.Sha256);
                if (installer != null) keep.Add(installer.Sha256);
                if (busy && installerStatus == "downloading") return;
                if (busy && status == "downloading") return;
            }
            foreach (string file in Directory.GetFiles(objectsDir))
            {
                if (!keep.Contains(Path.GetFileName(file))) File.Delete(file);
            }
        }
        catch (Exception) { }
    }

    // ---------- 本机的状态文件 ----------

    static void LoadState()
    {
        string path = Path.Combine(stateDir, "state.json");
        if (!File.Exists(path)) return;
        try
        {
            Dictionary<string, object> raw = new JavaScriptSerializer().DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>;
            if (raw == null) return;
            if (raw.ContainsKey("autoCheck") && raw["autoCheck"] is bool) autoCheck = (bool)raw["autoCheck"];
            if (raw.ContainsKey("skip")) skipVersion = raw["skip"] as string;
            if (raw.ContainsKey("lastCheck") && raw["lastCheck"] is string)
            {
                DateTime t;
                if (DateTime.TryParse((string)raw["lastCheck"], null, System.Globalization.DateTimeStyles.RoundtripKind, out t)) lastCheck = t.ToUniversalTime();
            }
            if (raw.ContainsKey("pending")) pendingVersion = raw["pending"] as string;
            if (raw.ContainsKey("unconfirmed") && raw["unconfirmed"] is int) unconfirmed = (int)raw["unconfirmed"];
            object[] bad = raw.ContainsKey("bad") ? raw["bad"] as object[] : null;
            if (bad != null) foreach (object b in bad) if (b is string) badVersions.Add((string)b);
        }
        catch (Exception) { }
    }

    static void SaveState()
    {
        Dictionary<string, object> d = new Dictionary<string, object>();
        d["autoCheck"] = autoCheck;
        d["skip"] = skipVersion;
        d["lastCheck"] = lastCheck == DateTime.MinValue ? null : lastCheck.ToString("o");
        d["pending"] = pendingVersion;
        d["unconfirmed"] = unconfirmed;
        d["bad"] = badVersions;
        try { Replace(Path.Combine(stateDir, "state.json"), Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(d))); }
        catch (Exception) { }
    }

    // 先写临时文件再换过去：写到一半断电，原来的文件还是好的
    static void Replace(string path, byte[] bytes)
    {
        string temp = path + ".tmp";
        File.WriteAllBytes(temp, bytes);
        if (File.Exists(path)) File.Replace(temp, path, null);
        else File.Move(temp, path);
    }

    static string Hex(byte[] bytes)
    {
        StringBuilder sb = new StringBuilder(bytes.Length * 2);
        foreach (byte b in bytes) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }

    static string Mb(long bytes)
    {
        return (bytes / 1048576.0).ToString("0.0") + " MB";
    }

    static void Log(string zh, string ja, string en)
    {
        Console.WriteLine("  " + Launcher.Pick(zh, ja, en));
    }
}
