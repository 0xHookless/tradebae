#include "DeepStack.h"

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QSaveFile>
#include <QTextStream>
#include <QProcess>
#include <QTcpSocket>
#include <QElapsedTimer>
#include <QDateTime>
#include <QRegularExpression>
#include <QThread>

#include <windows.h>
#include <tlhelp32.h>
#include <shellapi.h>

namespace {

// Domains redirected into the local stack. demoapi.cqg.com routes through the
// MITM (demo logon patching for DeepCharts); api.cqg.com is relayed verbatim to
// the real production gateway (MotiveWave); the historical pair feeds the
// local mock history server.
static const char* kDomains[] = {
    "demoapi.cqg.com",
    "api.cqg.com",
    "depth-it.historical.deepcharts.com",
    "data-b.historical.deepcharts.com",
};

static const char* kOurStackExes[] = {
    "deepchartsproxy.exe",
    "deepchartshistserver.exe",
};

static QString programDataCertDir() {
    QString pd = qEnvironmentVariable("ProgramData");
    if (pd.isEmpty()) pd = "C:/ProgramData";
    return pd + "/DeepCharts/certs/mitm_ca";
}

static bool portOpen(quint16 port) {
    QTcpSocket s;
    s.connectToHost(QHostAddress::LocalHost, port);
    const bool up = s.waitForConnected(1500);
    s.abort();
    return up;
}

static QString processImagePath(DWORD pid) {
    QString path;
    HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    if (h) {
        wchar_t buf[MAX_PATH + 2] = {};
        DWORD sz = MAX_PATH + 1;
        if (QueryFullProcessImageNameW(h, 0, buf, &sz))
            path = QString::fromWCharArray(buf);
        CloseHandle(h);
    }
    return path;
}

static QString processImageName(DWORD pid) {
    return QFileInfo(processImagePath(pid)).fileName().toLower();
}

static void killStackOwnedListeners(quint16 port, bool* foreignSeen) {
    QProcess p;
    p.start("netstat", QStringList() << "-ano" << "-p" << "TCP");
    p.waitForFinished(8000);
    const QString out = QString::fromLocal8Bit(p.readAllStandardOutput() + p.readAllStandardError());
    QRegularExpression rx("\\s");
    for (const QString& raw : out.split('\n')) {
        const QString line = raw.trimmed();
        const QStringList tok = line.split(rx, Qt::SkipEmptyParts);
        if (tok.size() < 5 || tok[0] != "TCP" || tok[3] != "LISTENING") continue;
        const QString local = tok[1];
        const int idx = local.lastIndexOf(':');
        if (idx < 0 || local.mid(idx + 1).toUShort() != port) continue;
        bool isNumber = false;
        const DWORD pid = tok[4].toUInt(&isNumber);
        if (!isNumber || pid == 0) continue;
        const QString img = processImageName(pid);
        bool ours = false;
        for (const char* n : kOurStackExes) {
            if (img == QString::fromLatin1(n)) { ours = true; break; }
        }
        if (!ours) { if (foreignSeen) *foreignSeen = true; continue; }
        HANDLE h = OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pid);
        if (h) {
            TerminateProcess(h, 1);
            WaitForSingleObject(h, 8000);
            CloseHandle(h);
        }
        QElapsedTimer t; t.start();
        while (portOpen(port) && t.elapsed() < 8000)
            Sleep(250);
    }
}

// Newest freshly-written engine log's tail, for error diagnostics. Engine logs
// live under %LOCALAPPDATA%\DeepCharts\logs and are rotated per proxy start.
static QString stackLogTail() {
    const QString logs = qEnvironmentVariable("LocalAppData") + "/DeepCharts/logs";
    QDir dir(logs);
    if (!dir.exists()) return QString();
    const QFileInfoList fresh = dir.entryInfoList(
        QStringList() << "bridge_mitm_*.log" << "vol_hist_*.log",
        QDir::Files, QDir::Time);
    if (fresh.isEmpty()) return QString();
    if (fresh.first().lastModified().secsTo(QDateTime::currentDateTime()) > 180) return QString();
    QFile f(fresh.first().absoluteFilePath());
    if (!f.open(QIODevice::ReadOnly)) return QString();
    f.seek(qMax<qint64>(0, f.size() - 1200));
    QStringList lines;
    for (const QString& l : QString::fromUtf8(f.readAll()).split('\n', Qt::SkipEmptyParts)) {
        const QString t = l.trimmed();
        if (!t.isEmpty()) lines << t;
    }
    if (lines.isEmpty()) return QString();
    const int skip = lines.size() > 4 ? lines.size() - 4 : 0;
    return "recent engine log [" + fresh.first().fileName() + "]: " +
           lines.mid(skip).join(" | ");
}

// Detects Windows port exclusions (winnat / Hyper-V / WSL reserved ranges)
// which silently break binding a listener even when nothing else uses the port.
static bool portInExcludedRange(quint16 port, QString* rangeOut) {
    QProcess p;
    p.start("netsh", QStringList() << "interface" << "ipv4" << "show"
                                  << "excludedportrange" << "protocol=tcp");
    p.waitForFinished(8000);
    static const QRegularExpression ws("\\s");
    for (const QString& raw : QString::fromLocal8Bit(p.readAllStandardOutput()).split('\n')) {
        const QStringList tok = raw.trimmed().split(ws, Qt::SkipEmptyParts);
        if (tok.size() < 2) continue;
        bool okLo = false, okHi = false;
        const quint16 lo = tok[0].toUShort(&okLo);
        const quint16 hi = tok[1].toUShort(&okHi);
        if (!okLo || !okHi) continue;
        if (port >= lo && port <= hi) {
            if (rangeOut) *rangeOut = QString("%1-%2").arg(lo).arg(hi);
            return true;
        }
    }
    return false;
}

// Builds a UTF-16 environment block for CreateProcess, starting from the current
// process environment with our overrides applied.
static bool makeEnvBlock(const QHash<QString, QString>& overrides, QByteArray& out) {
    QString merged;
    LPWCH blk = GetEnvironmentStringsW();
    if (blk) {
        const wchar_t* c = blk;
        while (*c) {
            merged = merged + QString::fromWCharArray(c) + '\n';
            c += wcslen(c) + 1;
        }
        FreeEnvironmentStringsW(blk);
    }
    for (auto it = overrides.constBegin(); it != overrides.constEnd(); ++it) {
        // Replace any existing assignment of the same var (case-insensitively).
        QString kept;
        for (const QString& line : merged.split('\n', Qt::SkipEmptyParts)) {
            const int eq = line.indexOf('=');
            const QString var = eq < 0 ? line : line.left(eq);
            if (var.compare(it.key(), Qt::CaseInsensitive) == 0) continue;
            kept += line + '\n';
        }
        kept += it.key() + '=' + it.value() + '\n';
        merged = kept;
    }
    // Build UTF-16 block: entries separated by '\0', block ended by a double '\0'.
    QByteArray u16;
    for (const QString& line : merged.split('\n', Qt::SkipEmptyParts)) {
        const std::wstring w = line.toStdWString();
        u16.append(reinterpret_cast<const char*>(w.c_str()), int((w.size() + 1) * 2));
    }
    u16.append(QByteArray("\0\0", 2));
    out = u16;
    return !out.isEmpty();
}

static bool startHidden(const QString& exe, const QString& workDir,
                        const QHash<QString, QString>& overrides, DWORD* pidOut) {
    if (!QFile::exists(exe)) return false;
    QByteArray envBlk;
    makeEnvBlock(overrides, envBlk);

    const QString cmd = '"' + exe + '"';
    const QString wdir = workDir.isEmpty() ? QFileInfo(exe).absolutePath() : workDir;
    const std::wstring cmdW = cmd.toStdWString();
    const std::wstring dirW = wdir.toStdWString();

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi{};
    BOOL ok = CreateProcessW(
        nullptr,                                 // application name
        const_cast<wchar_t*>(cmdW.c_str()),      // command line (mutable)
        nullptr, nullptr, FALSE,
        CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
        envBlk.isEmpty() ? nullptr : const_cast<wchar_t*>(
            reinterpret_cast<const wchar_t*>(envBlk.constData())),
        dirW.c_str(), &si, &pi);
    if (ok) {
        if (pidOut) *pidOut = pi.dwProcessId;
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return true;
    }
    // Fallback: inherit the parent environment entirely (no custom overrides).
    ok = CreateProcessW(nullptr, const_cast<wchar_t*>(cmdW.c_str()), nullptr, nullptr,
                        FALSE, CREATE_NO_WINDOW, nullptr, dirW.c_str(), &si, &pi);
    if (ok) {
        if (pidOut) *pidOut = pi.dwProcessId;
        CloseHandle(pi.hThread);
        CloseHandle(pi.hProcess);
        return true;
    }
    return false;
}

static bool waitForPort(quint16 port, int timeoutMs) {
    QElapsedTimer t; t.start();
    while (t.elapsed() < timeoutMs) {
        if (portOpen(port)) return true;
        Sleep(500);
    }
    return false;
}

static bool ensureHostsRedirect(QString* err) {
    QString sysRoot = qEnvironmentVariable("SystemRoot");
    if (sysRoot.isEmpty()) {
        wchar_t winDir[MAX_PATH] = {0};
        if (GetWindowsDirectoryW(winDir, MAX_PATH)) sysRoot = QString::fromWCharArray(winDir);
        else sysRoot = "C:/Windows";
    }
    const QString hosts = sysRoot + "/System32/drivers/etc/hosts";
    const std::wstring wHosts = QDir::toNativeSeparators(hosts).toStdWString();

    QFile f(hosts);
    if (!f.open(QIODevice::ReadOnly | QIODevice::Text)) {
        if (err) *err = "cannot read hosts file at " + hosts;
        return false;
    }
    QStringList lines;
    QTextStream in(&f);
    while (!in.atEnd()) lines << in.readLine();
    f.close();

    QStringList missing;
    for (const char* d : kDomains) {
        const QString dom = QString::fromLatin1(d);
        bool have = false;
        for (const QString& lineRaw : lines) {
            const QString line = lineRaw.trimmed();
            if (line.isEmpty() || line.startsWith('#')) continue;
            const QStringList tok = line.split(QRegularExpression("\\s"), Qt::SkipEmptyParts);
            if (tok.size() >= 2 && tok[0].compare("127.0.0.1") == 0 &&
                tok[1].compare(dom, Qt::CaseInsensitive) == 0) {
                have = true;
                break;
            }
        }
        if (!have) missing << dom;
    }
    if (missing.isEmpty()) return true;

    lines << "" << "# DeepCharts local proxy stack (Trade Bay)";
    for (const QString& d : missing) lines << "127.0.0.1 " + d;

    // Check and clear read-only file attribute if present (a frequent cause of write failure
    // even when running as Administrator).
    DWORD attrs = GetFileAttributesW(wHosts.c_str());
    const bool wasReadOnly = (attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_READONLY));
    if (wasReadOnly) {
        SetFileAttributesW(wHosts.c_str(), attrs & ~FILE_ATTRIBUTE_READONLY);
    }

    bool wrote = false;

    // 1. Try direct in-place write first (does not create temporary files in drivers\etc,
    // avoiding EDR/antivirus heuristics that block temp file creation in system directories).
    {
        QFile directOut(hosts);
        if (directOut.open(QIODevice::WriteOnly | QIODevice::Truncate | QIODevice::Text)) {
            QTextStream outTs(&directOut);
            for (const QString& l : lines) outTs << l << "\r\n";
            directOut.flush();
            directOut.close();
            wrote = true;
        }
    }

    // 2. Fall back to atomic replacement via QSaveFile if direct write couldn't open.
    if (!wrote) {
        QSaveFile sf(hosts);
        if (sf.open(QIODevice::WriteOnly | QIODevice::Text)) {
            QString body;
            for (const QString& l : lines) body += l + "\r\n";
            sf.write(body.toUtf8());
            if (sf.commit()) {
                wrote = true;
            }
        }
    }

    // 3. If in-process write was denied (e.g. process is running as standard user, or
    // UAC filtered token), elevate via ShellExecuteExW("runas") to append missing entries.
    if (!wrote) {
        QString psScript = "$h = \\\"$env:SystemRoot\\System32\\drivers\\etc\\hosts\\\"; "
                           "if (Test-Path $h) { (Get-Item $h).IsReadOnly = $false; }; "
                           "Add-Content -Path $h -Value '`r`n# DeepCharts local proxy stack (Trade Bay)'; ";
        for (const QString& d : missing) {
            psScript += QString("Add-Content -Path $h -Value '127.0.0.1 %1'; ").arg(d);
        }
        psScript += "ipconfig /flushdns";

        const QString psArgs = QString("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command \"%1\"").arg(psScript);
        std::wstring wArgs = psArgs.toStdWString();

        SHELLEXECUTEINFOW sei = {};
        sei.cbSize = sizeof(sei);
        sei.fMask = SEE_MASK_NOCLOSEPROCESS;
        sei.lpVerb = L"runas";
        sei.lpFile = L"powershell.exe";
        sei.lpParameters = wArgs.c_str();
        sei.nShow = SW_HIDE;

        if (ShellExecuteExW(&sei)) {
            if (sei.hProcess) {
                WaitForSingleObject(sei.hProcess, 15000);
                CloseHandle(sei.hProcess);
            }
            // Verify if entries landed
            QFile verifyF(hosts);
            if (verifyF.open(QIODevice::ReadOnly | QIODevice::Text)) {
                QTextStream vin(&verifyF);
                QString content = vin.readAll();
                verifyF.close();
                bool allLanded = true;
                for (const QString& d : missing) {
                    if (!content.contains(d, Qt::CaseInsensitive)) { allLanded = false; break; }
                }
                if (allLanded) wrote = true;
            }
        }
    }

    if (!wrote) {
        if (err) {
            *err = "Cannot modify C:\\Windows\\System32\\drivers\\etc\\hosts. "
                   "The file may be marked Read-Only or locked by security software (Windows Defender, Bitdefender, etc.). "
                   "Please check hosts file properties (uncheck Read-only) or add Trade Bay to antivirus exclusions.";
        }
        return false;
    }

    QProcess::startDetached("ipconfig", QStringList() << "/flushdns");
    return true;
}

static bool runCapture(const QString& exe, const QStringList& args, int timeoutMs, int* exitCode) {
    QProcess p;
    p.setCreateProcessArgumentsModifier([](QProcess::CreateProcessArguments* a) {
        a->flags |= CREATE_NO_WINDOW;
        a->startupInfo->dwFlags &= ~STARTF_USESTDHANDLES;
    });
    p.start(exe, args);
    if (!p.waitForFinished(timeoutMs)) { p.kill(); p.waitForFinished(3000); }
    if (exitCode) *exitCode = p.exitCode();
    return p.state() != QProcess::Running;
}

} // namespace

// Re-imports our CA into the Windows Root store and, when present, every
// installed MotiveWave JRE truststore (system installs and Trade Bay ghost
// installs alike). Idempotent; safe to run on every launch.
static bool ensureCaTrusted(const QString& appDir) {
    const QString caPem = programDataCertDir() + "/ca.pem";
    if (!QFile::exists(caPem)) return false;

    int code = 0;
    runCapture("certutil", QStringList() << "-addstore" << "-f" << "Root" << caPem, 15000, &code);

    // MW's own JRE often ships without keytool, so fall back to a system JDK's.
    QString systemKeytool;
    const QString pf86 = qEnvironmentVariable("ProgramFiles(x86)");
    const QString pf = qEnvironmentVariable("ProgramFiles");
    for (const QString& base : { pf86, pf }) {
        if (base.isEmpty()) continue;
        const QDir javaRoot(QDir(base).filePath("Java"));
        const QFileInfoList jres = javaRoot.entryInfoList(QDir::Dirs | QDir::NoDotAndDotDot);
        for (const QFileInfo& jr : jres) {
            const QString cand = jr.absoluteFilePath() + "/bin/keytool.exe";
            if (QFile::exists(cand)) { systemKeytool = cand; break; }
        }
        if (!systemKeytool.isEmpty()) break;
    }

    // Truststores to refresh: system MotiveWave installs and this app's own
    // ghost-install JRE (either <appDir>/jre or <appDir>/app/jre).
    QStringList jreDirs;
    for (const QString& base : { pf86, pf }) {
        if (!base.isEmpty()) jreDirs << QDir(base).filePath("MotiveWave/jre");
    }
    if (!appDir.isEmpty()) {
        jreDirs << QDir(appDir).filePath("jre") << QDir(appDir).filePath("app/jre");
    }

    for (const QString& jreDir : jreDirs) {
        const QString keystore = QDir(jreDir).filePath("lib/security/cacerts");
        if (!QFile::exists(keystore)) continue;
        QString keytool = QDir(jreDir).filePath("bin/keytool.exe");
        if (!QFile::exists(keytool)) keytool = systemKeytool;
        if (keytool.isEmpty() || !QFile::exists(keytool)) continue;
        // Remove a previous import of our alias, then import the current CA.
        runCapture(keytool, QStringList() << "-delete" << "-alias" << "deepchartmitm"
                    << "-keystore" << keystore << "-storepass" << "changeit", 20000, &code);
        runCapture(keytool, QStringList() << "-importcert" << "-alias" << "deepchartmitm"
                    << "-file" << caPem << "-keystore" << keystore
                    << "-storepass" << "changeit" << "-noprompt", 20000, &code);
    }
    return true;
}

bool DeepStack::needsStack(const QString& appDir) {
    return QFile::exists(appDir + "/proxy/DeepChartsProxy/DeepChartsProxy.exe");
}

void DeepStack::stopStack(const QString& appDir) {
    Q_UNUSED(appDir);
    // These exe names are unique to our distribution, so kill every instance
    // regardless of where it runs from: a leftover stack from an older install
    // root (or an elevated one a non-elevated dir filter would miss) still
    // locks the DLLs a package update needs to replace.
    static const char* kStackNames[] = {
        "deepchartsproxy.exe",
        "deepchartshistserver.exe",
        "volumetricabridge.exe",
    };

    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return;
    PROCESSENTRY32W pe{};
    pe.dwSize = sizeof(pe);
    if (Process32FirstW(snap, &pe)) {
        do {
            const QString img = QString::fromWCharArray(pe.szExeFile).toLower();
            bool ours = false;
            for (const char* n : kStackNames)
                if (img == QLatin1String(n)) { ours = true; break; }
            if (!ours) continue;
            HANDLE h = OpenProcess(PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pe.th32ProcessID);
            if (h) {
                TerminateProcess(h, 1);
                WaitForSingleObject(h, 8000);
                CloseHandle(h);
            }
        } while (Process32NextW(snap, &pe));
    }
    CloseHandle(snap);
    // Handles/sockets release asynchronously after termination.
    QThread::msleep(500);
}

QString DeepStack::ensureStackIfInstalled(const QString& appDir, QString* detail) {
    const auto fail = [&](const char* state) -> QString {
        if (detail) *detail = stackLogTail();
        return QString::fromLatin1(state);
    };

    const QString proxyExe = appDir + "/proxy/DeepChartsProxy/DeepChartsProxy.exe";
    const QString histExe = appDir + "/proxy/DeepChartsHistServer/DeepChartsHistServer.exe";
    if (!QFile::exists(proxyExe) || !QFile::exists(histExe)) {
        if (detail) *detail = "proxy bundles absent from " + appDir;
        return "missing";
    }

    // Clear stale instances of OUR OWN stack processes holding the ports;
    // refusal is the right answer if the ports belong to someone else.
    bool foreignSeen = false;
    killStackOwnedListeners(443, &foreignSeen);
    killStackOwnedListeners(12010, &foreignSeen);
    if (foreignSeen) {
        if (detail) *detail = "third-party listeners on 443/12010 (netstat image names differ from ours)";
        return "foreign";
    }

    QString hErr;
    if (!ensureHostsRedirect(&hErr)) {
        if (detail) *detail = hErr;
        return "hosts-denied";
    }

    const QString certDir = programDataCertDir();
    if (!QDir().mkpath(certDir)) {
        if (detail) *detail = "cannot create " + certDir;
        return "ca-denied";
    }
    {
        // Write probe: catches ACL-denied ProgramData before processes spin up.
        const QString probe = certDir + "/.writeprobe";
        QFile f(probe);
        if (!f.open(QIODevice::WriteOnly)) {
            if (detail) *detail = "cannot write " + certDir + " (access denied)";
            return "ca-denied";
        }
        f.close();
        QFile::remove(probe);
    }

    // Hyper-V/WSL dynamically reserve port ranges; binding 443 inside one fails
    // silently no matter what we do. Fail early with the exact remedy.
    QString reserved;
    if (portInExcludedRange(443, &reserved)) {
        if (detail) *detail =
            "Windows (winnat/Hyper-V) has port 443 reserved inside range " + reserved +
            ". Fix (elevated): 'net stop winnat', relaunch this app, then 'net start winnat'.";
        return "start-failed";
    }

    // Bridge lives at <root>/bridge (flat layout) or <root>/app/bridge (new layout).
    QString bridgeDir = appDir + "/bridge";
    if (!QFile::exists(QDir(bridgeDir).filePath("VolumetricaBridge.exe")))
        bridgeDir = appDir + "/app/bridge";
    QHash<QString, QString> overseen;
    overseen.insert("CA_DIR", QDir(certDir).absolutePath());
    overseen.insert("CA_CERT", QDir(certDir).filePath("ca.pem"));
    overseen.insert("CA_KEY", QDir(certDir).filePath("ca.key"));
    overseen.insert("CERT", QDir(certDir).filePath("cert.pem"));
    overseen.insert("MITM_CA_KEY", QDir(certDir).filePath("key.pem"));
    overseen.insert("BRIDGE_EXE", QDir(bridgeDir).filePath("VolumetricaBridge.exe"));
    overseen.insert("BRIDGE_DIR", QDir(bridgeDir).absolutePath());
    overseen.insert("BRIDGE_PROCESS_NAME", "VolumetricaBridge.exe");

    // History server first (the proxy routes to it), then the MITM proxy
    // (which generates its CA on first start).
    if (!portOpen(12010)) {
        DWORD hpid = 0;
        if (!startHidden(histExe, QFileInfo(histExe).absolutePath(), overseen, &hpid))
            return fail("start-failed");
        if (!waitForPort(12010, 30000)) return fail("start-failed");
    }
    if (!portOpen(443)) {
        DWORD ppid = 0;
        if (!startHidden(proxyExe, QFileInfo(proxyExe).absolutePath(), overseen, &ppid))
            return fail("start-failed");
        QElapsedTimer t; t.start();
        while (t.elapsed() < 45000 && !portOpen(443)) {
            ensureCaTrusted(appDir);
            Sleep(500);
        }
        if (!waitForPort(443, 30000)) return fail("start-failed");
    }
    ensureCaTrusted(appDir);

    // Legacy app layout: start the CQG bridge directly. The bundled
    // BridgeWrapper would match the launcher's own process names and kill
    // us before Core starts, so it is never used.
    const QString bridgeExe = QDir(bridgeDir).filePath("VolumetricaBridge.exe");
    if (QFile::exists(bridgeExe)) {
        QHash<QString, QString> noOverrides;
        DWORD bpid = 0;
        startHidden(bridgeExe, QFileInfo(bridgeExe).absolutePath(), noOverrides, &bpid);
        Sleep(3000);
    }

    QProcess::startDetached("ipconfig", QStringList() << "/flushdns");
    return "ok";
}
