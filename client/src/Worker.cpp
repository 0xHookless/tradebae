#include "Worker.h"
#include "Crypto.h"
#include "ClientKeys.h"
#include "Hardening.h"
#include "GhostLaunch.h"
#include "DeepStack.h"
#include <QCoreApplication>
#include <QProcess>
#include <QStandardPaths>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QSettings>
#include <QNetworkRequest>
#include <QNetworkReply>
#include <QEventLoop>
#include <QTimer>
#include <QCryptographicHash>
#include <QUrlQuery>
#include <QRegularExpression>
#include <QDateTime>
#include <QThread>
#include <QSaveFile>
#include <QSet>
static const char* kUserAgent = "TradingLauncher/1.0";

// Extract a zip into destDir. Extractor chain, in order:
//   1. inbox C:\Windows\System32\tar.exe (normal Windows)
//   2. bundled 7za.exe (Wine prefixes — e.g. Sikarugir on macOS — ship no tar
//      and no PowerShell, but Wine runs a plain x64 console PE just fine)
//   3. PowerShell Expand-Archive (legacy fallback)
// Returns true on success.
static bool extractZip(const QString& zipPath, const QString& destDir, QString* errOut) {
    QDir().mkpath(destDir);
    QString lastErr;

    QProcess p;
    p.setProgram("C:\\Windows\\System32\\tar.exe");
    p.setArguments(QStringList() << "-xf" << zipPath << "-C" << destDir);
    p.start();
    if (p.waitForStarted(5000)) {
        if (p.waitForFinished(1500000)) {
            if (p.exitCode() == 0) return true;
            lastErr = QString::fromLocal8Bit(p.readAllStandardError());
        } else { p.kill(); if (errOut) *errOut = "Extraction timed out"; return false; }
    }

    QProcess p7;
    p7.setProgram(QCoreApplication::applicationDirPath() + "/7za.exe");
    p7.setArguments(QStringList() << "x" << "-y" << "-o" + destDir << zipPath);
    p7.start();
    if (p7.waitForStarted(5000)) {
        if (p7.waitForFinished(1500000)) {
            if (p7.exitCode() == 0) return true;
            lastErr = QString::fromLocal8Bit(p7.readAllStandardError());
        } else { p7.kill(); if (errOut) *errOut = "Extraction timed out"; return false; }
    }

    QProcess p2;
    p2.setProgram("powershell.exe");
    p2.setArguments(QStringList() << "-NoProfile" << "-Command"
        << QString("Expand-Archive -Path '%1' -DestinationPath '%2' -Force").arg(zipPath).arg(destDir));
    p2.start();
    if (!p2.waitForStarted(5000)) {
        if (errOut) *errOut = lastErr.isEmpty() ? "No extractor available" : lastErr;
        return false;
    }
    if (!p2.waitForFinished(900000)) { p2.kill(); if (errOut) *errOut = "Extraction timed out"; return false; }
    if (p2.exitCode() != 0) {
        const QString psErr = QString::fromLocal8Bit(p2.readAllStandardError());
        if (errOut) *errOut = lastErr.isEmpty() ? psErr : lastErr + " | fallback: " + psErr;
        return false;
    }
    return true;
}

// ATAS X / ATAS read user data (settings, indicators) from %APPDATA%\<program>\
// per OFT.Platform's RootSettingsFolder key. The package ships new indicator
// DLLs under AppData/Indicators; after extraction copy any missing/changed
// ones into %APPDATA%\<program>\Indicators so ATAS picks them up. Best-effort
// and non-destructive: never removes anything, skips locked files (ATAS
// running), leaves whatever the user compiled last newer in place.
static QString appDataProgramDir(const QString& slug) {
    static const QHash<QString, QString> kPrograms = {
        {"atas", "ATAS"},
        {"atas-x", "ATAS X"},
    };
    const auto it = kPrograms.constFind(slug);
    return it == kPrograms.constEnd() ? QString() : it.value();
}

static QByteArray fileSha256(const QString& path) {
    QFile f(path);
    if (!f.open(QIODevice::ReadOnly)) return QByteArray();
    QCryptographicHash h(QCryptographicHash::Sha256);
    char buf[1 << 16];
    while (true) {
        const qint64 n = f.read(buf, sizeof(buf));
        if (n <= 0) break;
        h.addData(buf, static_cast<int>(n));
    }
    return h.result();
}

static void syncAppDataIndicators(const QString& slug, const QString& dir) {
    const QString prog = appDataProgramDir(slug);
    if (prog.isEmpty()) return;
    const QString srcDir = dir + "/AppData/Indicators";
    const QDir src(srcDir);
    if (!src.exists()) return;
    QString roaming = qEnvironmentVariable("APPDATA");
    if (roaming.isEmpty()) roaming = QDir::homePath() + "/AppData/Roaming";
    if (roaming.isEmpty()) return;
    const QString dstDir = roaming + "/" + prog + "/Indicators";
    QDir().mkpath(dstDir);
    for (const QFileInfo& fi : src.entryInfoList(QDir::Files)) {
        const QString dst = dstDir + "/" + fi.fileName();
        const QFileInfo di(dst);
        if (di.exists()) {
            // Install dir is the source of truth after an update: replace the roaming
            // copy whenever content differs (a same-size older build must not survive).
            if (di.size() == fi.size() && fileSha256(dst) == fileSha256(fi.absoluteFilePath())) continue;
            if (!QFile::remove(dst)) continue;  // locked by a running ATAS — retry next launch
        }
        QFile::copy(fi.absoluteFilePath(), dst);
    }
}
// Signature is standard base64 of raw 64-byte P1363 r||s over the exact
// base64url payload bytes (server signs payload_b64.encode(), crypto.py sign_bytes).
// Verify an offline license token's signature against the pinned client key.
// Signature is standard base64 of raw 64-byte P1363 r||s over the exact
// base64url payload bytes (server signs payload_b64.encode(), crypto.py sign_bytes).
static bool verify_bytes(const QByteArray& data, const QString& sigB64) {
    const QByteArray sig = Crypto::base64Decode(sigB64);
    const QByteArray pubX = Crypto::base64Decode(TP_PUBKEY_X);
    const QByteArray pubY = Crypto::base64Decode(TP_PUBKEY_Y);
    return Crypto::ecdsaVerify(data, sig, pubX, pubY);
}

// base64url padding helper
static QString pad_for(int length) {
    const int rem = length % 4;
    if (rem == 0) return QString();
    return QString(4 - rem, '=');
}

// Numeric version compare ("1.2.10" > "1.2.9"). Unknown parts count as 0.
static int compareVersions(const QString& a, const QString& b) {
    const QStringList pa = a.split('.'), pb = b.split('.');
    for (int i = 0; i < qMax(pa.size(), pb.size()); ++i) {
        const int na = i < pa.size() ? pa[i].toInt() : 0;
        const int nb = i < pb.size() ? pb[i].toInt() : 0;
        if (na != nb) return na < nb ? -1 : 1;
    }
    return 0;
}

Worker::Worker(QObject* parent) : QObject(parent) {
    m_nam = new QNetworkAccessManager(this);
}

Worker::~Worker() {}

QString Worker::serverUrl() const {
    QSettings s;
    QString u = s.value("serverUrl", "http://127.0.0.1:8000").toString().trimmed();
    while (u.endsWith('/')) u.chop(1);
    return u;
}

QString Worker::licenseKey() const {
    const QString k = QSettings().value("licenseKey").toString().trimmed();
    if (!k.isEmpty()) return k;
    const QJsonDocument saved = QJsonDocument::fromJson(QSettings().value("uiLicenses").toString().toUtf8());
    if (saved.isArray() && !saved.array().isEmpty())
        return saved.array().last().toObject().value("key").toString().trimmed();
    return QString();
}

QStringList Worker::candidateKeysFor(const QString& slug) const {
    QStringList out;
    auto addKey = [&](const QString& k) {
        const QString t = k.trimmed();
        if (t.isEmpty()) return;
        for (const QString& existing : out)
            if (existing.compare(t, Qt::CaseInsensitive) == 0) return;
        out.append(t);
    };
    const QJsonDocument saved = QJsonDocument::fromJson(QSettings().value("uiLicenses").toString().toUtf8());
    if (saved.isArray()) {
        const QJsonArray arr = saved.array();
        for (int i = arr.size() - 1; i >= 0; --i) {
            const QJsonObject o = arr[i].toObject();
            const QJsonArray prods = o.value("products").toArray();
            for (const QJsonValue& pv : prods) {
                const QString p = pv.toString();
                if (p == "*" || p.compare(slug, Qt::CaseInsensitive) == 0) {
                    addKey(o.value("key").toString());
                    break;
                }
            }
        }
    }
    addKey(QSettings().value("licenseKey").toString());
    if (saved.isArray()) {
        const QJsonArray arr = saved.array();
        for (int i = arr.size() - 1; i >= 0; --i)
            addKey(arr[i].toObject().value("key").toString());
    }
    return out;
}

QString Worker::installRoot() const {
    QSettings s;
    QString v = s.value("installRoot").toString().trimmed();
    if (!v.isEmpty()) {
        while (v.endsWith('/') || v.endsWith('\\')) v.chop(1);
        return v;
    }
    return QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + "/apps";
}

QString Worker::cacheRoot() const {
    return QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + "/cache";
}

QByteArray Worker::pubX() const { return Crypto::base64Decode(TP_PUBKEY_X); }
QByteArray Worker::pubY() const { return Crypto::base64Decode(TP_PUBKEY_Y); }

Worker::Response Worker::httpGet(const QUrl& url, const QString& accept) {
    QNetworkRequest req(url);
    req.setHeader(QNetworkRequest::UserAgentHeader, kUserAgent);
    if (!accept.isEmpty()) req.setRawHeader("Accept", accept.toLatin1());
    QNetworkReply* r = m_nam->get(req);
    QEventLoop loop;
    QTimer timer;
    timer.setSingleShot(true);
    timer.setInterval(15000);
    QObject::connect(r, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    QObject::connect(&timer, &QTimer::timeout, &loop, &QEventLoop::quit);
    timer.start();
    loop.exec();
    Response res;
    if (r->isFinished()) {
        res.status = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        res.body = r->readAll();
        res.ok = (r->error() == QNetworkReply::NoError);
    } else {
        r->abort();
    }
    r->deleteLater();
    return res;
}

Worker::Response Worker::download(const QUrl& url, qint64 expected, const QString& slug,
                                  const QString& fileLabel, QByteArray* out) {
    QNetworkRequest req(url);
    req.setHeader(QNetworkRequest::UserAgentHeader, kUserAgent);
    QNetworkReply* r = m_nam->get(req);
    QEventLoop loop;
    QTimer timer;
    timer.setSingleShot(true);
    timer.setInterval(60000);
    QTimer poll;
    poll.setInterval(100);
    QObject::connect(r, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    QObject::connect(&timer, &QTimer::timeout, &loop, &QEventLoop::quit);
    QObject::connect(&poll, &QTimer::timeout, &loop, [&]() {
        if (m_cancelled) { r->abort(); loop.quit(); }
    });
    QObject::connect(r, &QNetworkReply::downloadProgress, this,
                     [&](qint64 recv, qint64 total) {
                         if (expected > 0)
                             emit appProgress(slug, static_cast<int>(qMin<qint64>(99, recv * 100 / expected)), fileLabel);
                     });
    timer.start();
    poll.start();
    loop.exec();
    Response res;
    if (r->isFinished()) {
        res.status = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        res.body = r->readAll();
        res.ok = (r->error() == QNetworkReply::NoError);
    } else {
        r->abort();
    }
    r->deleteLater();
    if (out) *out = res.body;
    return res;
}

// Streaming download with HTTP Range resume. Writes to destPath (kept as
// destPath + ".part" until complete). Survives stalls/tunnel drops within
// a few reconnect attempts. Returns ok=true when destPath exists and is final.
Worker::Response Worker::downloadToFile(const QUrl& url, qint64 expected, const QString& slug,
                                        const QString& fileLabel, const QString& destPath) {
    Response res;
    QDir().mkpath(QFileInfo(destPath).absolutePath());
    const QString partPath = destPath + ".part";
    static const qint64 kIdleMs = 30000;   // tunnel stalls: detect dead streams fast

    for (int attempt = 0; attempt < 8 && !res.ok; ++attempt) {
        if (attempt > 0) {
            QThread::msleep(1000 + attempt * 500);
            emit appState(slug, "downloading",
                          QString("Connection stalled — resuming from %1% (attempt %2/8)")
                              .arg(expected > 0 ? QFileInfo(partPath).size() * 100 / qMax<qint64>(expected, 1) : 0)
                              .arg(attempt + 1));
        }
        if (m_cancelled) return res;

        qint64 have = QFileInfo(partPath).exists() ? QFileInfo(partPath).size() : 0;
        if (expected > 0 && have > expected) { QFile::remove(partPath); have = 0; }
        if (expected > 0 && have == expected) break;  // complete from an earlier phase

        const bool resuming = (have > 0);
        QNetworkRequest req(url);
        req.setRawHeader("User-Agent", kUserAgent);
        if (resuming) req.setRawHeader("Range", QByteArray("bytes=") + QByteArray::number(have) + '-');

        QNetworkReply* r = m_nam->get(req);
        QFile out(partPath);
        int status = 0;
        bool sawResponse = false;   // headers consumed (metaDataChanged)
        bool fullRestart = false;   // server ignored Range -> restart from zero
        bool fatalOut = false;      // disk write failed - stop trying
        qint64 lastActivity = QDateTime::currentMSecsSinceEpoch();

        QObject::connect(r, &QNetworkReply::metaDataChanged, r, [&]() {
            if (sawResponse) return;
            sawResponse = true;
            status = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
            if (resuming && status == 200) {
                // Server ignored the Range header: body will be the whole file.
                fullRestart = true;
                r->abort();
            }
        });
        QObject::connect(r, &QNetworkReply::readyRead, r, [&]() {
            lastActivity = QDateTime::currentMSecsSinceEpoch();
            if (!sawResponse) return;
            if (!out.isOpen()) {
                const bool appendMode = resuming && status == 206;
                if (!out.open(appendMode ? (QIODevice::WriteOnly | QIODevice::Append) : QIODevice::WriteOnly)) {
                    fatalOut = true;
                    r->abort();
                    return;
                }
            }
            if (out.write(r->readAll()) < 0) { fatalOut = true; r->abort(); }
        });
        QObject::connect(r, &QNetworkReply::downloadProgress, r, [&](qint64 recv, qint64 total) {
            lastActivity = QDateTime::currentMSecsSinceEpoch();
            const qint64 base = (status == 206 && resuming) ? have : 0;
            const qint64 denom = expected > 0 ? expected : ((status == 206 && resuming) ? have + total : total);
            if (denom > 0) {
                const qint64 cur = base + (sawResponse && !fullRestart ? recv : 0);
                const qint64 pct = qMax<qint64>(0, qMin<qint64>(cur * 100 / denom, 99));
                emit appProgress(slug, static_cast<int>(pct), fileLabel);
            }
        });
        QObject::connect(r, &QNetworkReply::finished, r, [&]() { lastActivity = -1; });

        QEventLoop loop;
        QTimer poll;
        poll.setInterval(250);
        QTimer cancelPoll;
        cancelPoll.setInterval(250);
        QObject::connect(&poll, &QTimer::timeout, &loop, [&]() {
            if (lastActivity == -1) { loop.quit(); return; }
            if (QDateTime::currentMSecsSinceEpoch() - lastActivity > kIdleMs) {
                r->abort();
                loop.quit();
            }
        });
        QObject::connect(&cancelPoll, &QTimer::timeout, &loop, [&]() {
            if (m_cancelled) { r->abort(); loop.quit(); }
        });
        poll.start();
        cancelPoll.start();
        loop.exec();
        poll.stop();
        cancelPoll.stop();
        if (out.isOpen()) out.close();
        r->deleteLater();

        if (fatalOut) return res;             // keep .part for a later resume
        if (fullRestart) { if (!QFile::resize(partPath, 0)) QFile::remove(partPath); continue; }
        if (m_cancelled) return res;          // keep .part for a later resume

        const qint64 partSize = QFileInfo(partPath).size();
        if (expected <= 0) {
            // Size unknown: accept any complete-looking response.
            if (status == 200 || status == 206) {
                QFile::remove(destPath);
                if (QFile::rename(partPath, destPath)) { res.ok = true; break; }
            }
            continue;
        }
        if (partSize == expected) {
            QFile::remove(destPath);
            if (QFile::rename(partPath, destPath)) { res.ok = true; emit appProgress(slug, 100, fileLabel); break; }
            continue;
        }
        // Partial bytes exist: the next attempt resumes from .part via Range.
    }
    return res;
}

bool Worker::verifyManifest(const QByteArray& raw, const QString& sigB64) const {
    QByteArray sig = Crypto::base64Decode(sigB64);
    return Crypto::ecdsaVerify(raw, sig, pubX(), pubY());
}

static bool decodeManifestBytes(const QByteArray& raw, Manifest& m) {
    QJsonObject mo = QJsonDocument::fromJson(raw).object();
    m.raw = raw;
    m.appId =  mo.value("app_id").toString();
    m.displayName = mo.value("display_name").toString();
    m.version = mo.value("release_version").toString();
    m.zip_sha256 = mo.value("zip_sha256").toString();
    m.zip_size = static_cast<qint64>(mo.value("zip_size").toDouble());
    m.files.clear();
    for (const auto& v : mo.value("files").toArray()) {
        QJsonObject fo = v.toObject();
        ManifestFile mf;
        mf.relativePath = fo.value("relative_path").toString();
        mf.size = static_cast<qint64>(fo.value("size").toDouble());
        mf.sha256 = fo.value("sha256").toString();
        mf.role = fo.value("role").toString("normal");
        mf.required = fo.value("required").toBool(true);
        m.files.append(mf);
    }
    return m.valid();
}

void Worker::fetchCatalog(bool emitEvent) {
    Response res = httpGet(QUrl(serverUrl() + "/catalog"), "application/json");
    if (!res.ok || res.status != 200) {
        emit serverChecked(false, "Server unavailable");
        if (emitEvent) emit catalogFetched(QJsonArray());
        return;
    }
    QJsonDocument doc = QJsonDocument::fromJson(res.body);
    if (!doc.isArray()) {
        emit serverChecked(false, "Invalid catalog response");
        return;
    }
    m_catalog.clear();
    QJsonArray arr = doc.array();
    for (const auto& v : arr) {
        QJsonObject o = v.toObject();
        CatalogEntry e;
        e.slug = o.value("slug").toString();
        e.displayName = o.value("display_name").toString(e.slug);
        e.description = o.value("description").toString();
        e.iconUrl = o.value("icon_url").toString();
        e.installDirName = o.value("install_dir_name").toString(e.slug);
        e.executableName = o.value("executable_name").toString();
        e.launchArgs = o.value("launch_args").toString();
        e.separateExecutable = o.value("separate_executable").toBool();
        e.launchMode = o.value("launch_mode").toString();
        e.localStack = o.value("local_stack").toBool(false);
        e.latestVersion = o.value("latest_version").toString();
        e.totalSize = static_cast<qint64>(o.value("total_size").toDouble());
        m_catalog.insert(e.slug, e);
    }
    QDir().mkpath(cacheRoot());
    QFile cf(cacheRoot() + "/catalog.json");
    if (cf.open(QIODevice::WriteOnly)) cf.write(QJsonDocument(arr).toJson());
    if (emitEvent) {
        emit serverChecked(true, "Connected");
        emit catalogFetched(arr);
        // Client self-update is dispatched separately when idle; do not block catalog fetch.
    }
}

CatalogEntry Worker::entryFor(const QString& slug) const {
    if (m_catalog.contains(slug)) return m_catalog.value(slug);
    QFile cf(cacheRoot() + "/catalog.json");
    if (cf.open(QIODevice::ReadOnly)) {
        QJsonArray arr = QJsonDocument::fromJson(cf.readAll()).array();
        for (const auto& v : arr) {
            QJsonObject o = v.toObject();
            if (o.value("slug").toString() == slug) {
                CatalogEntry e;
                e.slug = slug;
                e.displayName = o.value("display_name").toString(slug);
                e.installDirName = o.value("install_dir_name").toString(slug);
                e.executableName = o.value("executable_name").toString();
                e.launchArgs = o.value("launch_args").toString();
                e.separateExecutable = o.value("separate_executable").toBool();
                e.launchMode = o.value("launch_mode").toString();
                e.localStack = o.value("local_stack").toBool(false);
                e.latestVersion = o.value("latest_version").toString();
                return e;
            }
        }
    }
    CatalogEntry e;
    e.slug = slug;
    e.displayName = slug;
    e.installDirName = slug;
    return e;
}

bool Worker::prepareLocalStack(const CatalogEntry& e, const QString& slug) {
    if (!e.localStack) return true;
    QString root = appInstallDir(e);
    if (!DeepStack::needsStack(root) && e.slug != "deepcharts") {
        // The stack ships with DeepCharts; other consumers (MotiveWave) reference it.
        const CatalogEntry dc = entryFor("deepcharts");
        const QString dcRoot = appInstallDir(dc);
        if (DeepStack::needsStack(dcRoot)) root = dcRoot;
    }
    if (!DeepStack::needsStack(root)) {
        emit appState(slug, "failed", "Local data stack missing");
        emit errorOccurred(slug, "This platform is powered by the DeepCharts data stack. Install DeepCharts first (it ships the local CQG proxy), then relaunch.");
        return false;
    }
    emit appState(slug, "launching", "Starting local data engine...");
    QString detail;
    const QString st = DeepStack::ensureStackIfInstalled(root, &detail);
    emit appLog(slug, "Local data engine: " + st + (detail.isEmpty() ? "" : " — " + detail));
    if (st == "foreign") {
        emit appState(slug, "failed", "Port 443/12010 is in use by another program");
        emit errorOccurred(slug, "A third-party program is holding the local data engine ports (443/12010). Close it and relaunch. " + detail);
        return false;
    }
    if (st == "hosts-denied") {
        emit appState(slug, "failed", "Cannot update hosts file");
        emit errorOccurred(slug, detail.isEmpty()
            ? QString("Cannot update C:\\Windows\\System32\\drivers\\etc\\hosts. Run Trade Bay as administrator, check that hosts is not read-only, or allow it in antivirus.")
            : detail);
        return false;
    }
    if (st == "ca-denied") {
        emit appState(slug, "failed", "Cannot write engine certificate store");
        emit errorOccurred(slug, "The local data engine cannot create its certificates in C:\\ProgramData\\DeepCharts. Check folder permissions or run Trade Bay once as administrator. " + detail);
        return false;
    }
    if (st == "start-failed") {
        emit appState(slug, "failed", "Local data engine failed to start");
        emit errorOccurred(slug, detail.isEmpty()
            ? QString("The local data engine could not start (antivirus may be blocking it - check Windows Protection history and %LOCALAPPDATA%\\DeepCharts\\logs).")
            : QString("The local data engine could not start. %1").arg(detail));
        return false;
    }
    return true;
}

QString Worker::appInstallDir(const CatalogEntry& e) const {
    QSettings s;
    const QString custom = s.value("dirs/" + e.slug).toString().trimmed();
    if (!custom.isEmpty()) {
        QString c = custom;
        while (c.endsWith('/') || c.endsWith('\\')) c.chop(1);
        if (!c.isEmpty()) return c;
    }
    QString name = e.installDirName.isEmpty() ? e.slug : e.installDirName;
    name.replace(QRegularExpression("[^A-Za-z0-9 _.-]"), "_");
    name.replace("..", "_");
    return installRoot() + "/" + name;
}

bool Worker::verifyPathSafe(const QString& rel, const QString& root, QString* absOut) const {
    QString p = rel;
    p.replace('\\', '/');
    if (p.isEmpty() || p.startsWith('/') || p.contains(':')) return false;
    QStringList parts = p.split('/', Qt::SkipEmptyParts);
    for (const QString& s : parts)
        if (s == ".." || s == ".") return false;
    QString clean = QDir::cleanPath(p);
    if (clean.startsWith("..")) return false;
    QString abs = QDir(root).absoluteFilePath(clean);
    QString rootAbs = QDir(root).absolutePath();
    if (!abs.startsWith(rootAbs + "/")) return false;
    if (absOut) *absOut = abs;
    return true;
}

bool Worker::fileMatches(const QString& path, const QString& sha) const {
    if (!QFile::exists(path)) return false;
    QString err;
    QByteArray h = Crypto::sha256File(path, &err);
    return !h.isEmpty() && QString::fromLatin1(h.toHex()) == sha.toLower();
}

// Checks every package (zip) file on disk against the manifest's size. Cheap enough to run on
// every launch, and it catches files removed after extraction (antivirus quarantine, cleanup).
QStringList Worker::missingPackageFiles(const Manifest& m, const QString& dir) const {
    QStringList missing;
    for (const auto& f : m.files) {
        if (f.role == "executable") continue;  // payload is handled separately
        QString abs;
        if (!verifyPathSafe(f.relativePath, dir, &abs)) { missing << f.relativePath; continue; }
        const QFileInfo fi(abs);
        if (!fi.exists() || !fi.isFile() || fi.size() != f.size) missing << f.relativePath;
    }
    return missing;
}

bool Worker::loadCachedManifest(const QString& slug, Manifest& m) const {
    QDir().mkpath(cacheRoot() + "/manifests");
    QFile f(cacheRoot() + "/manifests/" + slug + ".json");
    if (!f.open(QIODevice::ReadOnly)) return false;
    QJsonObject o = QJsonDocument::fromJson(f.readAll()).object();
    QString rawS = o.value("raw").toString();
    QString sig = o.value("signature").toString();
    QByteArray raw = rawS.toUtf8();
    if (!verifyManifest(raw, sig)) return false;
    if (!decodeManifestBytes(raw, m)) return false;
    m.signature = sig;
    return true;
}

void Worker::saveCachedManifest(const Manifest& m) const {
    QDir().mkpath(cacheRoot() + "/manifests");
    const QString cacheFile = cacheRoot() + "/manifests/" + m.appId + ".json";
    // Archive the previous cached version's snapshot before overwriting, so a
    // later update can diff against the manifest the client actually had.
    {
        QFile old(cacheFile);
        if (old.open(QIODevice::ReadOnly)) {
            const QJsonObject oo = QJsonDocument::fromJson(old.readAll()).object();
            const QString rawS = oo.value("raw").toString();
            Manifest prev;
            if (!rawS.isEmpty() && decodeManifestBytes(rawS.toUtf8(), prev) && prev.version != m.version) {
                QFile archive(cacheRoot() + "/manifests/" + m.appId + "-" + prev.version + ".json");
                if (archive.open(QIODevice::WriteOnly)) archive.write(rawS.toUtf8());
            }
        }
    }
    QJsonObject o;
    o.insert("raw", QString::fromUtf8(m.raw));
    o.insert("signature", m.signature);
    QFile f(cacheFile);
    if (f.open(QIODevice::WriteOnly)) f.write(QJsonDocument(o).toJson());
}

// Persist the exact manifest behind a completed install so a future update can
// compute the stale-file set for THIS installed version.
void Worker::saveManifestSnapshot(const Manifest& m) const {
    QDir().mkpath(cacheRoot() + "/manifests");
    QJsonObject o;
    o.insert("raw", QString::fromUtf8(m.raw));
    o.insert("signature", m.signature);
    QFile f(cacheRoot() + "/manifests/" + m.appId + "-" + m.version + ".json");
    if (f.open(QIODevice::WriteOnly)) f.write(QJsonDocument(o).toJson());
}

// Delete files the previous release shipped that the new release dropped.
// Only touches files present in the old version snapshot, absent from the new
// manifest (package files only, never the payload), still byte-identical to
// what the old manifest said (untouched by the user). Empty directories left
// behind are pruned afterwards.
void Worker::cleanupStaleFiles(const QString& slug, const QString& fromVersion, const Manifest& latest, const QString& dir) const {
    if (fromVersion.isEmpty() || fromVersion == latest.version) return;
    QFile f(cacheRoot() + "/manifests/" + slug + "-" + fromVersion + ".json");
    if (!f.open(QIODevice::ReadOnly)) return;  // no snapshot from before 1.3.6 → nothing to diff
    const QJsonObject o = QJsonDocument::fromJson(f.readAll()).object();
    const QString rawS = o.value("raw").toString();
    Manifest old;
    if (rawS.isEmpty() || !decodeManifestBytes(rawS.toUtf8(), old)) return;

    QSet<QString> current;
    for (const auto& file : latest.files)
        if (file.role != "executable") current.insert(file.relativePath.toLower());

    QSet<QString> touchedDirs;
    for (const auto& file : old.files) {
        if (file.role == "executable") continue;
        const QString rel = file.relativePath;
        if (current.contains(rel.toLower())) continue;
        QString abs;
        if (!verifyPathSafe(rel, dir, &abs)) continue;
        QFileInfo fi(abs);
        if (!fi.exists() || !fi.isFile()) continue;
        if (fi.size() != file.size) continue;  // user-modified → leave alone
        if (QString::fromLatin1(Crypto::sha256File(abs).toHex()) != file.sha256.toLower()) continue;
        const QString parent = fi.absolutePath();
        if (QFile::remove(abs)) touchedDirs.insert(parent);
    }
    // prune emptied directories, walking up to the install root
    for (;;) {
        bool removed = false;
        QSet<QString> next = touchedDirs;
        for (const QString& d : next) {
            QDir dirObj(d);
            if (!dirObj.exists()) continue;
            if (!dirObj.isEmpty()) continue;
            const QString parent = QDir::cleanPath(d + "/..");
            if (QDir().rmdir(d)) {
                touchedDirs.remove(d);
                if (parent != dir && parent.startsWith(dir, Qt::CaseInsensitive)) {
                    touchedDirs.insert(parent);
                    removed = true;
                }
            }
        }
        if (!removed) break;
    }
}

bool Worker::fetchManifest(const QString& slug, Manifest& m, bool& online) {
    online = false;
    Response res = httpGet(QUrl(serverUrl() + "/catalog/" + slug + "/manifest"), "application/json");
    if (res.ok && res.status == 200) {
        QJsonObject o = QJsonDocument::fromJson(res.body).object();
        QString rawS = o.value("manifest_raw").toString();
        QString sig = o.value("signature").toString();
        QByteArray raw = rawS.toUtf8();
        if (raw.isEmpty() || sig.isEmpty()) { emit errorOccurred(slug, "Invalid manifest response"); return false; }
        if (!verifyManifest(raw, sig)) { emit errorOccurred(slug, "Invalid manifest signature"); return false; }
        if (!decodeManifestBytes(raw, m)) { emit errorOccurred(slug, "Manifest is incomplete"); return false; }
        m.signature = sig;
        saveCachedManifest(m);
        online = true;
        return true;
    }
    if (loadCachedManifest(slug, m)) {
        online = false;
        return true;
    }
    emit errorOccurred(slug,
        res.status == 404 ? "No published release for this platform"
                          : "Server unavailable and no cached manifest");
    return false;
}

bool Worker::payloadCached(const Manifest& m, const QString& slug, QByteArray& out) const {
    const ManifestFile* exe = nullptr;
    for (const auto& f : m.files) if (f.role == "executable") { exe = &f; break; }
    if (!exe) return false;
    QString base = cacheRoot() + "/payloads/" + slug + "-" + m.version;
    QFile sf(base + ".sha");
    if (!sf.open(QIODevice::ReadOnly)) return false;
    if (QString::fromLatin1(sf.readAll()).trimmed().toLower() != exe->sha256.toLower()) return false;
    QFile pf(base + ".bin");
    if (!pf.open(QIODevice::ReadOnly)) return false;
    QByteArray blob = pf.readAll();
    if (!Crypto::dpapiUnprotect(blob, out)) return false;
    QByteArray h = Crypto::sha256Bytes(out);
    return QString::fromLatin1(h.toHex()) == exe->sha256.toLower();
}

QString Worker::cachedToken() const {
    return QSettings().value("licenseToken").toString();
}

void Worker::saveCachedToken(const QString& token) const {
    QSettings().setValue("licenseToken", token);
}

void Worker::deleteCachedToken() const {
    QSettings().remove("licenseToken");
}

bool Worker::checkDecodedToken(const QJsonObject& body, QString* error) {
    const QString hwid = Crypto::hwid();
    if (body.value("hwid").toString() != hwid) {
        if (error) *error = "License issued for a different device";
        return false;
    }
    const qint64 exp = static_cast<qint64>(body.value("exp").toDouble(0));
    if (exp <= 0) { if (error) *error = "License token malformed"; return false; }
    const QDateTime expires = QDateTime::fromSecsSinceEpoch(exp);
    if (expires < QDateTime::currentDateTimeUtc()) {
        if (error) *error = "License expired";
        return false;
    }
    return true;
}

void Worker::jobCheckToken() {
    const QString token = cachedToken();
    if (token.isEmpty()) {
        emit licenseTokenCheckedSignal(false, "No license on this device");
        return;
    }
    const int dot = token.indexOf('.');
    if (dot <= 0) {
        emit licenseTokenCheckedSignal(false, "Corrupt license token");
        return;
    }
    const QString payloadB64 = token.left(dot);
    const QString sigB64 = token.mid(dot + 1);
    if (!verify_bytes(payloadB64.toUtf8(), sigB64)) {
        deleteCachedToken();
        emit licenseTokenCheckedSignal(false, "Corrupt license token");
        return;
    }
    QByteArray rawJson = QByteArray::fromBase64(QByteArray(payloadB64.toUtf8() + pad_for(payloadB64.length()).toUtf8()));
    QJsonObject body = QJsonDocument::fromJson(rawJson).object();
    QString err;
    if (!checkDecodedToken(body, &err)) {
        deleteCachedToken();
        emit licenseTokenCheckedSignal(false, err);
        return;
    }
    QString expiresIso = QDateTime::fromSecsSinceEpoch(
                             static_cast<qint64>(body.value("exp").toDouble()))
                             .toString(Qt::ISODate);
    const qint64 exp = static_cast<qint64>(body.value("exp").toDouble());
    int daysRemaining = -1;
    if (exp > 0) {
        daysRemaining = static_cast<int>(QDateTime::currentDateTimeUtc()
                                             .secsTo(QDateTime::fromSecsSinceEpoch(exp)) / 86400);
        if (daysRemaining < 0) daysRemaining = 0;
    }
    emit licenseDetailsSignal(expiresIso, daysRemaining);
    emit licenseTokenCheckedSignal(true,
        body.value("scope").toString() == "*" ? "Valid for all applications"
                                              : "Valid: " + body.value("scope").toString());
}

void Worker::jobLicenseStatus() {
    const QString key = licenseKey();
    if (key.isEmpty()) {
        emit licenseResult(false, "No license key entered");
        return;
    }
    QJsonObject body{{"key", key}, {"hwid", Crypto::hwid()}, {"software_slug", "*"}};
    QNetworkRequest req(QUrl(serverUrl() + "/licenses/status"));
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    QNetworkReply* r = m_nam->post(req, QJsonDocument(body).toJson());
    QEventLoop loop; QTimer timer; timer.setSingleShot(true); timer.setInterval(15000);
    QObject::connect(r, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    QObject::connect(&timer, &QTimer::timeout, &loop, &QEventLoop::quit);
    timer.start(); loop.exec();
    const bool ok = r->isFinished() && r->error() == QNetworkReply::NoError;
    const QByteArray data = r->readAll();
    r->deleteLater();
    if (!ok) { emit licenseResult(false, "Server unreachable"); return; }
    emit serverChecked(true, "Connected");
    QJsonObject o = QJsonDocument::fromJson(data).object();
    if (o.value("revoked").toBool()) { emit licenseResult(false, "License revoked on server"); return; }
    if (o.value("expired").toBool()) { emit licenseResult(false, "License expired"); return; }
    if (o.contains("bound") && o.value("bound").toBool() && !o.value("hwid_matches").toBool()) {
        emit licenseResult(false, "License bound to another device");
        return;
    }
    QString expiresIso;
    int daysRemaining = -1;
    if (o.contains("expires_at") && !o.value("expires_at").toString().isEmpty()) {
        QDateTime e = QDateTime::fromString(o.value("expires_at").toString(), Qt::ISODate);
        if (e.isValid()) {
            expiresIso = e.toString(Qt::ISODate);
            daysRemaining = static_cast<int>(QDateTime::currentDateTimeUtc().secsTo(e) / 86400);
            if (daysRemaining < 0) daysRemaining = 0;
        }
    }
    emit licenseDetailsSignal(expiresIso, daysRemaining);
    emit licenseResult(true, "License looks valid");
}

void Worker::jobActivate() {
    const QString key = licenseKey();
    if (key.isEmpty()) { emit licenseResult(false, "No license key entered"); return; }
    QJsonObject body{{"key", key}, {"hwid", Crypto::hwid()}, {"software_slug", "*"}};
    QNetworkRequest req(QUrl(serverUrl() + "/licenses/activate"));
    req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    QNetworkReply* r = m_nam->post(req, QJsonDocument(body).toJson());
    QEventLoop loop; QTimer timer; timer.setSingleShot(true); timer.setInterval(15000);
    QObject::connect(r, &QNetworkReply::finished, &loop, &QEventLoop::quit);
    QObject::connect(&timer, &QTimer::timeout, &loop, &QEventLoop::quit);
    timer.start(); loop.exec();
    const bool ok = r->isFinished() && r->error() == QNetworkReply::NoError;
    const int status = r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const QByteArray data = r->readAll();
    r->deleteLater();
    if (!ok) {
        QString msg = status == 403 ? "License rejected (revoked, expired, scope, or bound to another device)"
                    : status == 401 ? "Unknown license key"
                    : "Server unreachable";
        deleteCachedToken();
        emit licenseResult(false, msg);
        return;
    }
    emit serverChecked(true, "Connected");
    const QJsonObject o = QJsonDocument::fromJson(data).object();
    const QString token = o.value("license_token").toString();
    if (token.isEmpty()) { emit licenseResult(false, "Server returned no license token"); return; }
    saveCachedToken(token);
    // Show server-truth expiry when the client token parse succeeds
    QString expiresIso;
    int daysRemaining = -1;
    if (o.contains("expires_at") && !o.value("expires_at").toString().isEmpty()) {
        QDateTime e = QDateTime::fromString(o.value("expires_at").toString(), Qt::ISODate);
        if (e.isValid()) {
            expiresIso = e.toString(Qt::ISODate);
            daysRemaining = static_cast<int>(QDateTime::currentDateTimeUtc().secsTo(e) / 86400);
            if (daysRemaining < 0) daysRemaining = 0;
        }
    }
    emit licenseDetailsSignal(expiresIso, daysRemaining);
    emit licenseResult(true, "License activated and bound to this device");
}

// Self-update: fetches /client-update, compares to this build, and when the
// server knows a newer client, downloads the new installer (hash-verified) and
// reports it via clientUpdateReady. Errors are silent — an outdated updater
// must never block the app.
void Worker::jobClientUpdate() {
    struct Guard { std::atomic_bool& f; Guard(std::atomic_bool& b) : f(b) { f = true; } ~Guard() { f = false; } } guard(m_inClientUpdate);
    Response res = httpGet(QUrl(serverUrl() + "/client-update"), "application/json");
    if (!res.ok || res.status != 200) return;
    QJsonObject o = QJsonDocument::fromJson(res.body).object();
    const QString remote = o.value("version").toString().trimmed();
    const QString local = QString::fromLatin1(TP_CLIENT_VERSION);
    if (remote.isEmpty() || remote == local) return;
    if (compareVersions(remote, local) <= 0) return;  // same or older build stays untouched

    const QString url = o.value("url").toString();
    const QString sha = o.value("sha256").toString();
    if (url.isEmpty() || sha.isEmpty()) return;
    const qint64 size = static_cast<qint64>(o.value("size").toDouble());

    QDir().mkpath(cacheRoot() + "/client");
    const QString dst = cacheRoot() + "/client/TradeBayInstaller-" + remote + ".exe";
    if (QFileInfo(dst).exists() && QFileInfo(dst).size() == size
        && QString::fromLatin1(Crypto::sha256File(dst).toHex()) == sha.toLower()) {
        emit clientUpdateReady(remote, o.value("notes").toString(), dst);
        return;
    }
    emit appState("update", "downloading", "Updating Trade Bay...");
    Response r = downloadToFile(QUrl(serverUrl() + url), size, "update", "Trade Bay " + remote, dst);
    if (!r.ok || !QFile::exists(dst)) return;
    QString hErr;
    const QByteArray h = Crypto::sha256File(dst, &hErr);
    if (h.isEmpty() || QString::fromLatin1(h.toHex()) != sha.toLower()) { QFile::remove(dst); return; }
    emit appState("update", "ready", "Trade Bay updated to " + remote);
    emit clientUpdateReady(remote, o.value("notes").toString(), dst);
}

void Worker::run(const QString& job, const QString& slug) {
    m_cancelled = false;
    if (job == "cancel") { m_cancelled = true; return; }
    if (job == "catalog") { fetchCatalog(true); return; }
    if (job == "clientUpdate") { jobClientUpdate(); return; }
    if (job == "license") { jobActivate(); return; }
    if (job == "licenseStatus") { jobLicenseStatus(); return; }
    if (job == "checkToken") { jobCheckToken(); return; }

    if (job == "check") {
        emit appState(slug, "checking", "Checking installation...");
        Manifest m; bool online = false;
        if (!fetchManifest(slug, m, online)) {
            emit appState(slug, "failed", "Unable to load manifest");
            return;
        }
        CatalogEntry e = entryFor(slug);
        const QString dir = appInstallDir(e);
        bool allMatch = true;
        int missing = 0;
        for (const auto& f : m.files) {
            if (m_cancelled) break;
            if (f.role == "executable" && e.separateExecutable) {
                QByteArray tmp;
                if (!payloadCached(m, slug, tmp)) { allMatch = false; ++missing; }
            } else {
                QString abs;
                if (!verifyPathSafe(f.relativePath, dir, &abs) || !fileMatches(abs, f.sha256)) {
                    allMatch = false; ++missing;
                }
            }
        }
        QSettings rec;
        const QString installedVer = rec.value("installed/" + slug).toString();
        emit appInfo(slug, allMatch ? m.version : installedVer, m.version, allMatch, !allMatch && !installedVer.isEmpty());
        emit appState(slug, allMatch ? "ready" : "notinstalled",
                      allMatch ? "Ready to launch"
                               : (installedVer.isEmpty() ? "Not installed" : "Update available"));
        emit serverChecked(online, online ? "Connected" : "Offline / cached");
        return;
    }

    if (job == "start" || job == "install") {
        const bool installOnly = (job == "install");
        // License gate: explicit, offline-safe. Cached token must validate locally
        // if present; first-time runs with a license key proceed (activation
        // happens during the download step below).
        {
            QString err;
            const QString token = cachedToken();
            bool licensed = false;
            if (token.isEmpty()) {
                if (!licenseKey().isEmpty()) licensed = true;  // first-run: activate below
            } else {
                const int dot = token.indexOf('.');
                if (dot > 0) {
                    const QString payloadB64 = token.left(dot);
                    const QString sigB64 = token.mid(dot + 1);
                    if (verify_bytes(payloadB64.toUtf8(), sigB64)) {
                        QString pad = pad_for(payloadB64.length());
                        QByteArray rawJson = QByteArray::fromBase64(QByteArray(payloadB64.toUtf8() + pad.toUtf8()));
                        QJsonObject body = QJsonDocument::fromJson(rawJson).object();
                        if (checkDecodedToken(body, &err)) licensed = true;
                    }
                }
                if (!licensed) {
                    deleteCachedToken();
                    if (!candidateKeysFor(slug).isEmpty()) licensed = true;
                }
            }
            if (!licensed) {
                emit appState(slug, "failed", err.isEmpty() ? "Enter a valid license to continue" : err);
                emit errorOccurred(slug, "License required");
                return;
            }
        }
        CatalogEntry e = entryFor(slug);
        const QString dir = appInstallDir(e);
        emit appState(slug, "checking", "Checking installation...");
        Manifest m; bool online = false;
        if (!fetchManifest(slug, m, online)) { emit appState(slug, "failed", "Unable to load manifest"); return; }
        emit serverChecked(online, online ? "Connected" : "Offline / cached");

        // --- R2 zip path (non-executable files) ---
        bool zipUsed = false;
        if (!m.zip_sha256.isEmpty()) {
            const QString marker = cacheRoot() + "/zip-extracted/" + slug + "-" + m.version + ".sha";
            bool needExtract = true;
            QFile mf(marker);
            if (mf.open(QIODevice::ReadOnly)) {
                if (QString::fromLatin1(mf.readAll()).trimmed() == m.zip_sha256) needExtract = false;
                mf.close();
            }
            // The marker only proves an extraction happened once. If files were removed since
            // (antivirus quarantine, manual cleanup), extract again instead of trusting it.
            if (!needExtract) {
                const QStringList gone = missingPackageFiles(m, dir);
                if (!gone.isEmpty()) {
                    emit appLog(slug, QString("%1 package files are missing (e.g. %2). Re-extracting.")
                                .arg(gone.size()).arg(gone.first()));
                    needExtract = true;
                }
            }
            if (needExtract) {
                if (!online) {
                    emit appState(slug, "failed", "Server offline and zip not extracted");
                    emit errorOccurred(slug, "Server offline: cannot download changes");
                    return;
                }
                // Get presigned URL
                const QStringList candKeys = candidateKeysFor(slug);
                const QString initialKey = candKeys.isEmpty() ? licenseKey() : candKeys.first();
                QJsonObject body{{"key", initialKey}, {"hwid", Crypto::hwid()}, {"software_slug", slug}};
                // Prefer cached token if present
                const QString tok = cachedToken();
                if (!tok.isEmpty()) body.insert("license_token", tok);
                QNetworkRequest zr(QUrl(serverUrl() + "/download/" + slug + "/" + m.version + "/zip-url"));
                zr.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
                QNetworkReply* zreply = m_nam->post(zr, QJsonDocument(body).toJson());
                QEventLoop zloop; QTimer zt; zt.setSingleShot(true); zt.setInterval(300000); // server may build the zip on demand for large packages
                QObject::connect(zreply, &QNetworkReply::finished, &zloop, &QEventLoop::quit);
                QObject::connect(&zt, &QTimer::timeout, &zloop, &QEventLoop::quit);
                zt.start(); zloop.exec();
                // A stale/wrong-scope cached token is rejected with 403 even when the license key is fine.
                // Drop it and retry once with the license key alone.
                if (zreply->isFinished() && !tok.isEmpty()
                    && (zreply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() == 403
                        || zreply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() == 401)) {
                    zreply->deleteLater();
                    deleteCachedToken();
                    body.remove("license_token");
                    zreply = m_nam->post(zr, QJsonDocument(body).toJson());
                    QObject::connect(zreply, &QNetworkReply::finished, &zloop, &QEventLoop::quit);
                    zt.start(); zloop.exec();
                }
                if (zreply->isFinished() && zreply->error() != QNetworkReply::NoError && candKeys.size() > 1) {
                    for (int ki = 1; ki < candKeys.size(); ++ki) {
                        const int st = zreply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
                        if (st != 401 && st != 403) break;
                        zreply->deleteLater();
                        body.remove("license_token");
                        body.insert("key", candKeys[ki]);
                        zreply = m_nam->post(zr, QJsonDocument(body).toJson());
                        QObject::connect(zreply, &QNetworkReply::finished, &zloop, &QEventLoop::quit);
                        zt.start(); zloop.exec();
                        if (zreply->isFinished() && zreply->error() == QNetworkReply::NoError) {
                            QSettings().setValue("licenseKey", candKeys[ki]);
                            break;
                        }
                    }
                }
                if (!zreply->isFinished() || zreply->error() != QNetworkReply::NoError) {
                    zreply->deleteLater();
                    const QByteArray errRaw = zreply->isFinished() ? zreply->readAll() : QByteArray();
                    const QString srvDetail = QJsonDocument::fromJson(errRaw).object().value("detail").toString();
                    const int zhttp = zreply->isFinished() ? zreply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt() : 0;
                    const QString why = !zreply->isFinished() ? QString("timed out")
                        : (!srvDetail.isEmpty() ? QString("%1 (HTTP %2)").arg(srvDetail).arg(zhttp)
                                                : QString("HTTP %1 %2").arg(zhttp).arg(zreply->errorString()));
                    emit appState(slug, "failed", QString("Failed to get download URL: %1").arg(why));
                    emit errorOccurred(slug, "zip-url request failed");
                    return;
                }
                QJsonObject zo = QJsonDocument::fromJson(zreply->readAll()).object();
                zreply->deleteLater();
                const QString url = zo.value("url").toString();
                QString fullUrl = url;
                if (!fullUrl.startsWith("http", Qt::CaseInsensitive))
                    fullUrl = serverUrl() + fullUrl;
                const QString sha = zo.value("sha256").toString();
                const qint64 sz = static_cast<qint64>(zo.value("size").toDouble());
                if (url.isEmpty() || sha.isEmpty()) {
                    emit appState(slug, "failed", "Invalid download URL response");
                    return;
                }
                emit appState(slug, "downloading", "Downloading package...");
                const QString zipPath = cacheRoot() + "/temp/" + slug + "-" + m.version + ".zip";
                Response r = downloadToFile(QUrl(fullUrl), sz, slug, "package.zip", zipPath);
                if (m_cancelled) { emit appState(slug, "failed", "Cancelled"); return; }
                if (!r.ok || !QFile::exists(zipPath)) {
                    emit appState(slug, "failed", "Download failed");
                    emit errorOccurred(slug, "Download kept losing connection. Click Install again — it resumes from where it stopped.");
                    return;
                }
                QString hErr;
                const QByteArray h = Crypto::sha256File(zipPath, &hErr);
                if (h.isEmpty() || QString::fromLatin1(h.toHex()) != sha.toLower()) {
                    emit appState(slug, "failed", "Package integrity check failed");
                    emit errorOccurred(slug, hErr.isEmpty() ? "zip hash mismatch" : ("zip hashing failed: " + hErr));
                    QFile::remove(zipPath);
                    return;
                }
                emit appState(slug, "installing", "Extracting package...");
                QDir().mkpath(dir);
                DeepStack::stopStack(dir);  // running stack locks the DLLs being replaced
                QString exErr;
                if (!extractZip(zipPath, dir, &exErr)) {
                    emit appState(slug, "failed", "Extraction failed: " + exErr);
                    emit errorOccurred(slug, "extract failed: " + exErr);
                    QFile::remove(zipPath);
                    return;
                }
                QFile::remove(zipPath);
                syncAppDataIndicators(slug, dir);
                // Verify what actually landed on disk before recording success.
                const QStringList gone = missingPackageFiles(m, dir);
                if (!gone.isEmpty()) {
                    QFile::remove(marker);
                    const QString why = QString("Only %1 of %2 files landed (missing e.g.: %3). "
                        "If antivirus is active it likely quarantined files — add the install folder "
                        "to its exclusions and install again. Otherwise retry; if it repeats, report this exact message.")
                        .arg(m.files.size() - gone.size()).arg(m.files.size())
                        .arg(gone.mid(0, 3).join(", "));
                    emit appState(slug, "failed", "Package incomplete");
                    emit errorOccurred(slug, why);
                    return;
                }
                QDir().mkpath(cacheRoot() + "/zip-extracted");
                QFile mk(marker);
                if (mk.open(QIODevice::WriteOnly)) { mk.write(sha.toUtf8()); mk.close(); }
                emit appLog(slug, "Extracted package");
            }
            zipUsed = true;
        }

        QList<ManifestFile> toDownload;
        const ManifestFile* exeFile = nullptr;
        for (const auto& f : m.files) {
            if (f.role == "executable") { exeFile = &f; continue; }
            if (zipUsed) continue;  // handled by zip extraction above
            QString abs;
            if (!verifyPathSafe(f.relativePath, dir, &abs) || !fileMatches(abs, f.sha256)) toDownload.append(f);
        }
        QByteArray payload;
        bool havePayload = false;
        if (e.separateExecutable && exeFile) havePayload = payloadCached(m, slug, payload);

        if (toDownload.isEmpty() && (installOnly || !e.separateExecutable || havePayload)) {
            const QString fromVersion = QSettings().value("installed/" + slug).toString();
            if (fromVersion != m.version) {
                cleanupStaleFiles(slug, fromVersion, m, dir);  // files the new release dropped
                saveManifestSnapshot(m);                      // record manifest of THIS install
            }
            syncAppDataIndicators(slug, dir);
            emit appState(slug, "ready", "Ready to launch");
            QSettings().setValue("installed/" + slug, m.version);
            if (installOnly) {
                emit appInfo(slug, m.version, m.version, true, false);
                return;
            }
            if (e.separateExecutable && exeFile) {
                emit appState(slug, "launching", "Preparing " + e.displayName + "...");
                emit appLog(slug, "All files verified");
                if (e.launchMode == "ghost") {
                    if (!prepareLocalStack(e, slug)) return;
                    QString err;
                    if (GhostLaunch::launch(payload, exeFile->relativePath, dir, e.launchArgs, &err)) {
                        emit appLog(slug, "Ghost launch: " + exeFile->relativePath);
                        emit launched(slug, true, "Application started");
                        emit appState(slug, "running", "Application running");
                    } else {
                        emit launched(slug, false, err);
                        emit appState(slug, "failed", err);
                    }
                } else {
                    emit payloadReady(slug, payload, dir);
                }
            } else {
                const QString exe = dir + "/" + e.executableName;
                if (!QFile::exists(exe)) {
                    emit appState(slug, "failed", "Executable not found");
                    emit errorOccurred(slug, "Executable not found");
                    return;
                }
                emit appState(slug, "launching", "Launching " + e.displayName + "...");
                const bool ok = QProcess::startDetached(exe, QStringList() << e.launchArgs.split(' ', Qt::SkipEmptyParts), dir);
                emit launched(slug, ok, ok ? "Application started" : "Failed to start application");
                emit appState(slug, ok ? "running" : "failed", ok ? "Application running" : "Launch failed");
            }
            return;
        }

        if (!online) {
            if (e.separateExecutable && exeFile && !havePayload) {
                emit errorOccurred(slug, "Server is offline and the cached installer is missing a required update");
                emit appState(slug, "failed", "Server offline: cannot download changes");
            } else {
                emit errorOccurred(slug, "Server is offline and cached files are incomplete");
                emit appState(slug, "failed", "Server offline: cached files incomplete");
            }
            return;
        }

        // License binding can't be verified client-side; rely on server rejections.
        const QStringList actCands = candidateKeysFor(slug);
        QString key = actCands.isEmpty() ? licenseKey() : actCands.first();
        QJsonObject reqBody{{"key", key}, {"hwid", Crypto::hwid()}, {"software_slug", slug}};
        QNetworkRequest actReq(QUrl(serverUrl() + "/licenses/activate"));
        actReq.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
        QNetworkReply* lr = m_nam->post(actReq, QJsonDocument(reqBody).toJson());
        QEventLoop ll; QTimer lt; lt.setSingleShot(true); lt.setInterval(15000);
        QObject::connect(lr, &QNetworkReply::finished, &ll, &QEventLoop::quit);
        QObject::connect(&lt, &QTimer::timeout, &ll, &QEventLoop::quit);
        lt.start(); ll.exec();
        if (lr->isFinished() && lr->error() != QNetworkReply::NoError && actCands.size() > 1) {
            for (int ki = 1; ki < actCands.size(); ++ki) {
                const int st = lr->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
                if (st != 401 && st != 403) break;
                lr->deleteLater();
                key = actCands[ki];
                reqBody.insert("key", key);
                lr = m_nam->post(actReq, QJsonDocument(reqBody).toJson());
                QObject::connect(lr, &QNetworkReply::finished, &ll, &QEventLoop::quit);
                lt.start(); ll.exec();
                if (lr->isFinished() && lr->error() == QNetworkReply::NoError) {
                    QSettings().setValue("licenseKey", key);
                    break;
                }
            }
        }
        const int actStatus = lr->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const bool activated = lr->isFinished() && lr->error() == QNetworkReply::NoError;
        const QByteArray lbody = lr->readAll();
        lr->deleteLater();
        if (!activated) {
            deleteCachedToken();
            QString msg = actStatus == 403 ? "License rejected (revoked, expired, scope, or bound to another device)"
                        : actStatus == 401 ? "Unknown license key"
                        : "Server unreachable";
            emit errorOccurred(slug, msg);
            emit appState(slug, "failed", msg);
            return;
        }
        saveCachedToken(QJsonDocument::fromJson(lbody).object().value("license_token").toString());
        emit licenseResult(true, "License active");

        emit appState(slug, "downloading", "Downloading files...");
        QDir().mkpath(dir);
        int total = toDownload.size() + (e.separateExecutable && exeFile && !havePayload && online ? 1 : 0);
        int done = 0;
        for (const auto& f : toDownload) {
            if (m_cancelled) { emit appState(slug, "failed", "Cancelled"); return; }
            emit appState(slug, "downloading", "Downloading: " + f.relativePath);
            QUrl u(serverUrl() + "/download/" + slug + "/" + m.version + "/" + f.relativePath);
            QUrlQuery q; q.addQueryItem("license_key", key); q.addQueryItem("hwid", Crypto::hwid()); u.setQuery(q);
            QByteArray data;
            Response r = download(u, f.size, slug, f.relativePath, &data);
            if (m_cancelled) { emit appState(slug, "failed", "Cancelled"); return; }
            if (!r.ok || r.status != 200) {
                emit appState(slug, "failed", "Download failed: " + f.relativePath);
                emit errorOccurred(slug, "Download failed: " + f.relativePath);
                return;
            }
            QByteArray h = Crypto::sha256Bytes(data);
            if (QString::fromLatin1(h.toHex()) != f.sha256.toLower()) {
                emit appState(slug, "failed", "Integrity check failed: " + f.relativePath);
                emit errorOccurred(slug, "Hash mismatch: " + f.relativePath);
                return;
            }
            QString abs;
            if (!verifyPathSafe(f.relativePath, dir, &abs)) { emit appState(slug, "failed", "Unsafe path in manifest"); return; }
            QDir().mkpath(QFileInfo(abs).absolutePath());
            emit appState(slug, "installing", "Installing files...");
            QSaveFile out(abs);
            if (!out.open(QIODevice::WriteOnly) || out.write(data) != data.size() || !out.commit()) {
                emit appState(slug, "failed", "Cannot write: " + f.relativePath);
                emit errorOccurred(slug, "Cannot write file (locked or permission denied): " + f.relativePath);
                return;
            }
            ++done;
            emit appProgress(slug, total ? done * 100 / total : 0, f.relativePath);
            emit appLog(slug, "Installed " + f.relativePath);
        }

        emit appState(slug, "verifying", "Verifying files...");
        for (const auto& f : m.files) {
            if (f.role == "executable" || (zipUsed && toDownload.isEmpty())) continue;
            QString abs;
            if (!verifyPathSafe(f.relativePath, dir, &abs) || !fileMatches(abs, f.sha256)) {
                emit appState(slug, "failed", "Verification failed");
                emit errorOccurred(slug, "Verification failed: " + f.relativePath);
                return;
            }
        }
        const QString fromVersion = QSettings().value("installed/" + slug).toString();
        if (fromVersion != m.version) {
            cleanupStaleFiles(slug, fromVersion, m, dir);
            saveManifestSnapshot(m);
        }
        syncAppDataIndicators(slug, dir);
        emit appState(slug, "ready", "Ready to launch");
        QSettings().setValue("installed/" + slug, m.version);
        emit appInfo(slug, m.version, m.version, true, false);
        if (installOnly) return;

        if (e.separateExecutable && exeFile) {
            if (!havePayload && online) {
                emit appState(slug, "downloading", "Preparing " + e.displayName + "...");
                QUrl u(serverUrl() + "/download/" + slug + "/" + m.version + "/" + exeFile->relativePath);
                QUrlQuery q; q.addQueryItem("license_key", key); q.addQueryItem("hwid", Crypto::hwid()); u.setQuery(q);
                Response r = download(u, exeFile->size, slug, exeFile->relativePath, &payload);
                if (m_cancelled) { emit appState(slug, "failed", "Cancelled"); return; }
                if (!r.ok || r.status != 200) { emit appState(slug, "failed", "Download failed"); return; }
                QByteArray h = Crypto::sha256Bytes(payload);
                if (QString::fromLatin1(h.toHex()) != exeFile->sha256.toLower()) {
                    Hardening::wipe(payload);
                    emit appState(slug, "failed", "Executable integrity check failed");
                    return;
                }
                QDir().mkpath(cacheRoot() + "/payloads");
                const QString base = cacheRoot() + "/payloads/" + slug + "-" + m.version;
                QByteArray blob;
                if (Crypto::dpapiProtect(payload, blob)) {
                    QFile pf(base + ".bin");
                    if (pf.open(QIODevice::WriteOnly)) pf.write(blob);
                    QFile sf(base + ".sha");
                    if (sf.open(QIODevice::WriteOnly)) sf.write(exeFile->sha256.toUtf8());
                }
                ++done;
                emit appProgress(slug, 100, exeFile->relativePath);
            } else if (!havePayload && !online) {
                emit appState(slug, "failed", "Server offline and executable not cached");
                return;
            }
            emit appState(slug, "launching", "Preparing " + e.displayName + "...");
            emit appLog(slug, "All files verified");
            if (e.launchMode == "ghost") {
                if (!prepareLocalStack(e, slug)) return;
                QString err;
                if (GhostLaunch::launch(payload, exeFile->relativePath, dir, e.launchArgs, &err)) {
                    emit appLog(slug, "Ghost launch: " + exeFile->relativePath);
                    emit launched(slug, true, "Application started");
                    emit appState(slug, "running", "Application running");
                } else {
                    emit launched(slug, false, err);
                    emit appState(slug, "failed", err);
                }
            } else {
                emit payloadReady(slug, payload, dir);
            }
            return;
        }

        const QString exe = dir + "/" + e.executableName;
        if (!QFile::exists(exe)) { emit appState(slug, "failed", "Executable not found"); return; }
        emit appState(slug, "launching", "Launching " + e.displayName + "...");
        const bool ok = QProcess::startDetached(exe, QStringList() << e.launchArgs.split(' ', Qt::SkipEmptyParts), dir);
        emit launched(slug, ok, ok ? "Application started" : "Failed to start application");
        emit appState(slug, ok ? "running" : "failed", ok ? "Application running" : "Launch failed");
        return;
    }
}

void Worker::cancel() { m_cancelled = true; }
