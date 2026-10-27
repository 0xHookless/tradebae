#include "MainWindow.h"
#include "WebViewHost.h"
#include "LauncherCore.h"
#include "Models.h"

#include <QSettings>
#include <QJsonArray>
#include <QJsonDocument>
#include <QStandardPaths>
#include <QDir>
#include <QApplication>
#include <QFileDialog>
#include <QProcess>
#include <QWindow>
#include <QDateTime>

MainWindow::MainWindow(QWidget* parent) : QMainWindow(parent) {
    setWindowFlags(Qt::Window | Qt::FramelessWindowHint);
    setWindowTitle("Trade Bay");
    resize(1280, 800);
    setMinimumSize(980, 620);

    m_core = new LauncherCore(this);
    connect(m_core, &LauncherCore::serverStatus, this, &MainWindow::onServerStatus);
    connect(m_core, &LauncherCore::catalogChanged, this, &MainWindow::onCatalogChanged);
    connect(m_core, &LauncherCore::licenseStatus, this, &MainWindow::onLicense);
    connect(m_core, &LauncherCore::licenseDetails, this, &MainWindow::onLicenseDetails);
    connect(m_core, &LauncherCore::appStatus, this, &MainWindow::onAppState);
    connect(m_core, &LauncherCore::appProgress, this, &MainWindow::onAppProgress);
    connect(m_core, &LauncherCore::appLog, this, &MainWindow::onAppLog);
    connect(m_core, &LauncherCore::appInfo, this, &MainWindow::onAppInfo);
    connect(m_core, &LauncherCore::launched, this, &MainWindow::onLaunched);
    connect(m_core, &LauncherCore::clientUpdateNeedsSwap, this, &MainWindow::onClientUpdateReady);
    m_host = new WebViewHost(this);
    setCentralWidget(m_host);
    m_host->loadHtml(QCoreApplication::applicationDirPath() + "/app.html");

    connect(m_host, &WebViewHost::messageReceived, this, &MainWindow::onWebMessage);

    // Self-update safety net: re-check every 15 min while the app stays open, and
    // after boot even when the first server probe flaked. Jobs in flight (install)
    // gate the periodic dispatch; the boot dispatch always runs.
    m_clientUpdateTimer = new QTimer(this);
    m_clientUpdateTimer->setInterval(15 * 60 * 1000);
    connect(m_clientUpdateTimer, &QTimer::timeout, this, [this]() {
        if (!m_jobRunning) m_core->checkClientUpdate();
    });
    m_clientUpdateTimer->start();
    // Updates found quietly mid-session queue up and are applied on app close.
    QTimer::singleShot(60 * 1000, this, [this]() { m_bootWindow = false; });
}

// ---------- helpers ----------

static QString monoFor(const QString& name) {
    const QStringList w = name.split(' ', Qt::SkipEmptyParts);
    if (w.size() >= 2) return w[0].left(1).toUpper() + w[1].left(1).toUpper();
    return name.left(2).toUpper();
}

QString MainWindow::installRoot() const {
    QSettings s;
    QString v = s.value("installRoot").toString().trimmed();
    if (!v.isEmpty()) {
        while (v.endsWith('/') || v.endsWith('\\')) v.chop(1);
        return v;
    }
    return QStandardPaths::writableLocation(QStandardPaths::AppDataLocation) + "/apps";
}

QString MainWindow::entryExe(const QString& slug) const {
    for (const CatalogEntry& e : m_core->catalog())
        if (e.slug == slug) return e.executableName;
    return "executable";
}

QJsonObject MainWindow::catalogJson() const {
    QJsonArray arr;
    for (const CatalogEntry& e : m_core->catalog()) {
        QJsonObject o;
        o["id"] = e.slug;
        o["name"] = e.displayName;
        o["mono"] = monoFor(e.displayName);
        o["version"] = e.latestVersion;
        o["folder"] = e.installDirName;
        o["exe"] = e.executableName;
        o["desc"] = e.description;
        o["size"] = qRound64(e.totalSize / 1048576.0 * 10.0) / 10.0;
        arr.append(o);
    }
    QJsonObject root;
    root["catalog"] = arr;
    return root;
}

QJsonObject MainWindow::licenseJson() const {
    QJsonArray arr;
    const QJsonDocument saved = QJsonDocument::fromJson(QSettings().value("uiLicenses").toString().toUtf8());
    if (saved.isArray()) arr = saved.array();

    // The cached (server-verified) token is the source of truth for what a key owns.
    const QString token = QSettings().value("licenseToken").toString();
    const int dot = token.indexOf('.');
    if (dot > 0) {
        QString payloadB64 = token.left(dot);
        while (payloadB64.size() % 4 != 0) payloadB64 += '=';
        const QJsonObject body = QJsonDocument::fromJson(QByteArray::fromBase64(payloadB64.toUtf8())).object();
        const QString key = body.value("key").toString();
        QString scope = body.value("scope").toString();
        if (!key.isEmpty()) {
            QStringList products;
            const QJsonValue scv = body.value("scope");
            if (scv.isArray()) {
                for (const QJsonValue& v : scv.toArray()) products.append(v.toString());
            } else if (scope == "*") {
                for (const CatalogEntry& e : m_core->catalog()) products.append(e.slug);
            } else if (scope.contains(',')) {
                const QStringList parts = scope.split(',', Qt::SkipEmptyParts);
                for (const QString& p : parts) products.append(p.trimmed());
            } else if (!scope.isEmpty()) {
                products.append(scope);
            }
            // Keep only products that still exist in the catalog (skip when catalog not loaded yet)
            if (!m_core->catalog().isEmpty()) {
                QStringList known;
                for (const CatalogEntry& e : m_core->catalog()) known.append(e.slug);
                QStringList filtered;
                for (const QString& p : products)
                    if (known.contains(p, Qt::CaseSensitive)) filtered.append(p);
                products = filtered;
            }
            products.removeDuplicates();
            bool dup = false;
            for (const QJsonValue& v : arr)
                if (v.toObject().value("key").toString() == key) dup = true;
            if (!dup) {
                QJsonObject l;
                l["key"] = key;
                QJsonArray pa;
                for (const QString& p : products) pa.append(p);
                l["products"] = pa;
                l["at"] = static_cast<double>(QDateTime::currentMSecsSinceEpoch());
                arr.append(l);
            }
        }
    }
    QJsonObject root;
    root["licenses"] = arr;
    return root;
}

void MainWindow::sendCatalog() {
    if (!m_webReady) return;
    QJsonObject m = catalogJson();
    m["t"] = "catalog";
    m_host->post(m);
}

void MainWindow::sendUpdateState() {
    if (!m_webReady) return;
    QJsonObject installed;
    QJsonObject dirs;
    QSettings s;
    for (const CatalogEntry& e : m_core->catalog()) {
        const QString ver = s.value("installed/" + e.slug).toString();
        if (!ver.isEmpty()) {
            QJsonObject i;
            i["version"] = ver;
            i["at"] = static_cast<double>(QDateTime::currentMSecsSinceEpoch());
            i["dir"] = installRoot() + "/" + e.installDirName;
            installed[e.slug] = i;
        }
        const QString custom = s.value("dirs/" + e.slug).toString();
        if (!custom.isEmpty()) dirs[e.slug] = custom;
    }
    QJsonObject m;
    m["t"] = "update";
    m["installed"] = installed;
    m["dirs"] = dirs;
    m["licenses"] = licenseJson();
    m_host->post(m);
}

void MainWindow::sendInit() {
    if (!m_webReady) return;
    sendCatalog();
    QJsonObject m = licenseJson();
    m["t"] = "init";
    m["ver"] = QString::fromLatin1(TP_CLIENT_VERSION);

    QJsonObject installed;
    QJsonObject dirs;
    QSettings s;
    for (const CatalogEntry& e : m_core->catalog()) {
        const QString ver = s.value("installed/" + e.slug).toString();
        if (!ver.isEmpty()) {
            QJsonObject i;
            i["version"] = ver;
            i["at"] = static_cast<double>(QDateTime::currentMSecsSinceEpoch());
            i["dir"] = installRoot() + "/" + e.installDirName;
            installed[e.slug] = i;
        }
        const QString custom = s.value("dirs/" + e.slug).toString();
        if (!custom.isEmpty()) dirs[e.slug] = custom;
    }
    m["installed"] = installed;
    m["dirs"] = dirs;

    QJsonObject settings;
    settings["server"] = m_core->serverUrl();
    settings["installDir"] = installRoot();
    settings["startup"] = s.value("startup", false).toBool();
    settings["updates"] = s.value("updates", true).toBool();
    settings["tray"] = s.value("tray", false).toBool();
    m["settings"] = settings;

    m["logs"] = QJsonArray();
    m["running"] = QJsonArray();
    m_initSent = true;
    m_host->post(m);
}

void MainWindow::replyProbe(bool ok) {
    QJsonObject m;
    m["t"] = "probe";
    m["seq"] = m_probeSeq;
    m["ok"] = ok;
    m["latency"] = ok ? static_cast<double>(m_probeTimer.isValid() ? m_probeTimer.elapsed() : 0) : 0;
    m_probePending = false;
    m_host->post(m);
}

void MainWindow::probeServer(int seq) {
    m_probeSeq = seq;
    m_probePending = true;
    m_probeTimer.start();
    m_core->refreshCatalog();
    // Server just answered: piggyback an update check (no-op when nothing new).
    if (!m_jobRunning) checkClientUpdate();
}

void MainWindow::postInstallEvent(const QString& phase, const QJsonObject& extra) {
    QJsonObject m{{"t", "installEvent"}, {"id", m_activeSlug}, {"phase", phase}};
    for (auto it = extra.begin(); it != extra.end(); ++it) m[it.key()] = it.value();
    m_host->post(m);
}

void MainWindow::stepLaunch(const QString& slug, int stepIdx, const QString& label) {
    if (m_launchSteps.isEmpty()) return;
    qint64 ms = 0;
    if (m_lastStep >= 0) ms = m_stepTimer.elapsed();
    m_stepTimer.restart();
    m_lastStep = stepIdx;
    m_host->post(QJsonObject{
        {"t", "launchEvent"},
        {"id", slug},
        {"steps", QJsonArray::fromStringList(m_launchSteps)},
        {"stepIdx", stepIdx},
        {"stepMs", static_cast<double>(ms)},
        {"label", label.isEmpty() ? m_launchSteps.value(qMin(stepIdx, m_launchSteps.size() - 1)) : label}});
}

void MainWindow::pumpInstall(const QString& slug, const QString& state, const QString& text) {
    if (m_activeJob != "install" || m_activeSlug != slug) return;
    if (state == "checking") postInstallEvent("phase", QJsonObject{{"text", "Requesting package"}});
    else if (state == "downloading") postInstallEvent("phase", QJsonObject{{"text", "Downloading"}});
    else if (state == "installing") postInstallEvent("phase", QJsonObject{{"text", "Extracting package"}});
    else if (state == "verifying") postInstallEvent("phase", QJsonObject{{"text", "Verifying files"}});
    else if (state == "ready") {        QString version;
        QString dir;
        for (const CatalogEntry& e : m_core->catalog()) {
            if (e.slug == slug) {
                version = e.latestVersion;
                dir = installRoot() + "/" + e.installDirName;
            }
        }
        postInstallEvent("done", QJsonObject{{"version", version}, {"dir", dir}});
        m_jobRunning = false;
    } else if (state == "failed") {
        postInstallEvent("failed", QJsonObject{{"text", text}});
        m_jobRunning = false;
    }
}

void MainWindow::maybeSwapClientUpdate() {
    if (m_jobRunning || m_pendingInstaller.isEmpty() || !m_bootWindow) return;
    // Boot window: nothing has happened yet, so swapping right away is safe and
    // invisible — the installer re-opens nothing (user relaunches).
    const QString path = m_pendingInstaller;
    m_pendingInstaller.clear();
    const QStringList args = { "/VERYSILENT", "/NORESTART", "/CLOSEAPPLICATIONS",
                               "/RESTARTAPPLICATIONS", "/FORCECLOSEAPPLICATIONS" };
    if (QProcess::startDetached(path, args)) QApplication::exit(0);
}

// ---------- web -> native ----------

void MainWindow::onWebMessage(const QJsonObject& obj) {
    const QString t = obj.value("t").toString();

    if (t == "ready") {
        m_webReady = true;
        sendInit();
        m_core->refreshCatalog();
        checkClientUpdate();
        return;
    }
    if (t == "probe") { probeServer(obj.value("seq").toInt(0)); return; }

    if (t == "install") {
        const QString id = obj.value("id").toString();
        m_activeJob = "install";
        m_jobRunning = true;
        m_activeSlug = id;
        m_core->installApp(id);
        return;
    }
    if (t == "launch") {
        const QString id = obj.value("id").toString();
        m_activeJob = "launch";
        m_activeSlug = id;
        m_jobRunning = true;
        m_lastStep = -1;
        const bool updates = QSettings().value("updates", true).toBool();
        m_launchSteps = QStringList{"Checking license"};
        if (updates) m_launchSteps << "Checking for updates";
        m_launchSteps << "Loading workspace" << ("Starting " + entryExe(id));
        m_stepTimer.start();
        stepLaunch(id, 0, m_launchSteps[0]);
        m_core->startApp(id);
        return;
    }
    if (t == "cancel") { m_core->cancel(); return; }

    if (t == "activate") {
        const QString key = obj.value("key").toString().trimmed().toUpper();
        m_actSeq = obj.value("seq").toInt(0);
        m_core->saveSettings(m_core->serverUrl(), key);
        m_core->activateLicense();
        return;
    }

    if (t == "removeLicense") {
        const QString key = obj.value("key").toString().trimmed().toUpper();
        QSettings s;
        // 1. drop the key from the saved list
        const QJsonDocument saved = QJsonDocument::fromJson(s.value("uiLicenses").toString().toUtf8());
        QJsonArray kept;
        if (saved.isArray()) {
            for (const QJsonValue& v : saved.array())
                if (v.toObject().value("key").toString().toUpper() != key) kept.append(v);
        }
        s.setValue("uiLicenses", QString::fromUtf8(QJsonDocument(kept).toJson(QJsonDocument::Compact)));
        // 2. drop the server-verified token when it belongs to this key: it re-adds the key on every refresh
        const QString token = s.value("licenseToken").toString();
        const int dot = token.indexOf('.');
        if (dot > 0) {
            QString payloadB64 = token.left(dot);
            while (payloadB64.size() % 4 != 0) payloadB64 += '=';
            const QJsonObject body = QJsonDocument::fromJson(QByteArray::fromBase64(payloadB64.toUtf8())).object();
            if (body.value("key").toString().toUpper() == key) s.remove("licenseToken");
        }
        // 3. forget the typed key when it was this one
        if (s.value("licenseKey").toString().trimmed().toUpper() == key)
            m_core->saveSettings(m_core->serverUrl(), QString());
        sendUpdateState();
        return;
    }

    if (t == "save") {
        const QJsonObject d = obj.value("data").toObject();
        QSettings s;
        QJsonDocument licensesDoc(d.value("licenses").toArray());
        s.setValue("uiLicenses", QString::fromUtf8(licensesDoc.toJson(QJsonDocument::Compact)));

        const QJsonObject dirsObj = d.value("dirs").toObject();
        const QStringList previous = s.value("uiDirsKeys").toStringList();
        for (const QString& old : previous)
            if (!dirsObj.contains(old)) s.setValue("dirs/" + old, QString());
        QStringList keys;
        for (auto it = dirsObj.begin(); it != dirsObj.end(); ++it) {
            s.setValue("dirs/" + it.key(), it.value().toString());
            keys.append(it.key());
        }
        s.setValue("uiDirsKeys", keys);

        const QJsonObject settings = d.value("settings").toObject();
        const QString server = settings.value("server").toString().trimmed();
        if (!server.isEmpty()) m_core->saveSettings(server, m_core->licenseKey());
        s.setValue("installRoot", settings.value("installDir").toString());
        s.setValue("startup", settings.value("startup").toBool());
        s.setValue("updates", settings.value("updates").toBool());
        s.setValue("tray", settings.value("tray").toBool());
        sendCatalog();
        return;
    }

    if (t == "browse") {
        const QString key = obj.value("key").toString();
        QString start = installRoot();
        for (const CatalogEntry& e : m_core->catalog())
            if (e.slug == key) start = installRoot() + "/" + e.installDirName;
        const QString picked = QFileDialog::getExistingDirectory(this, "Select folder", start);
        m_host->post(QJsonObject{{"t", "folderPick"}, {"key", key}, {"dir", picked.isEmpty() ? QString() : picked}});
        return;
    }

    if (t == "uninstall") {
        const QString id = obj.value("id").toString();
        QString dir = installRoot();
        for (const CatalogEntry& e : m_core->catalog())
            if (e.slug == id) dir = QSettings().value("dirs/" + e.slug).toString();
        auto clean = [](QString p) { while (p.endsWith('/') || p.endsWith('\\')) p.chop(1); return p; };
        QDir(clean(dir)).removeRecursively();
        QSettings().setValue("installed/" + id, QString());
        QSettings().setValue("dirs/" + id, QString());
        m_host->post(QJsonObject{{"t", "uninstallDone"}, {"id", id}, {"ok", true}});
        return;
    }

    if (t == "min") { showMinimized(); return; }
    if (t == "max") { isMaximized() ? showNormal() : showMaximized(); return; }
    if (t == "drag") { if (windowHandle()) windowHandle()->startSystemMove(); return; }
    if (t == "close") {
        // Apply a pending self-update silently as the app closes, rather than
        // surfacing it mid-session.
        if (!m_pendingInstaller.isEmpty()) {
            const QString path = m_pendingInstaller;
            m_pendingInstaller.clear();
            const QStringList args = { "/VERYSILENT", "/NORESTART" };
            if (QProcess::startDetached(path, args)) { QApplication::exit(0); return; }
        }
        QApplication::exit(0);
        return;
    }
}

// ---------- native -> web ----------

void MainWindow::onServerStatus(bool online, const QString& message) {
    Q_UNUSED(message);
    if (m_probePending) replyProbe(online);
    sendCatalog();
}

void MainWindow::onCatalogChanged() {
  sendCatalog();
  if (m_initSent) sendUpdateState();
}

void MainWindow::onLicense(bool valid, const QString& message) {
    if (!valid) {
        m_host->post(QJsonObject{{"t", "activateResult"}, {"seq", m_actSeq}, {"ok", false}, {"text", message}});
        return;
    }
    QJsonObject fresh;
    const QJsonObject lj = licenseJson();
    const QJsonArray arr = lj.value("licenses").toArray();
    QString want = m_core->licenseKey();
    for (const QJsonValue& v : arr) {
        if (v.toObject().value("key").toString() == want) { fresh = v.toObject(); break; }
    }
    if (fresh.isEmpty() && !arr.isEmpty()) fresh = arr.last().toObject();
    const qint64 at = static_cast<qint64>(fresh.value("at").toDouble(QDateTime::currentMSecsSinceEpoch()));
    m_host->post(QJsonObject{{"t", "activateResult"}, {"seq", m_actSeq}, {"ok", true},
                             {"products", fresh.value("products")}, {"at", static_cast<double>(at)}});
    sendCatalog();
}

void MainWindow::onLicenseDetails(const QString& expiresIso, int daysRemaining) {
    Q_UNUSED(expiresIso);
    Q_UNUSED(daysRemaining);
}

void MainWindow::onAppState(const QString& slug, const QString& state, const QString& text) {
    if (m_activeJob == "install" && m_activeSlug == slug) pumpInstall(slug, state, text);
    else if (m_activeJob == "launch" && m_activeSlug == slug) {
        int idx = -1;
        if (state == "checking") idx = 0;
        else if (state == "downloading" || state == "installing" || state == "verifying") idx = m_launchSteps.indexOf("Loading workspace");
        else if (state == "launching") idx = m_launchSteps.indexOf("Starting " + entryExe(slug));
        if (idx >= 0 && idx > m_lastStep) stepLaunch(slug, idx, QString());
        if (state == "failed") {
            m_host->post(QJsonObject{{"t", "launchEvent"}, {"id", slug}, {"done", true}, {"failed", true}, {"text", text}});
        } else if (state == "running") {
            m_host->post(QJsonObject{{"t", "launchEvent"}, {"id", slug}, {"done", true}});
        }
    }
}

void MainWindow::onAppProgress(const QString& slug, int percent, const QString& file) {
    if (m_activeJob != "install" || m_activeSlug != slug) return;
    postInstallEvent("pct", QJsonObject{
        {"pct", percent / 100.0},
        {"file", file.isEmpty() ? QString() : file}});
}

void MainWindow::onAppLog(const QString& slug, const QString& line) {
    if (m_activeJob != "install" || m_activeSlug != slug) return;
    postInstallEvent("log", QJsonObject{{"msg", line}, {"lvl", "info"}});
}

void MainWindow::onAppInfo(const QString& slug, const QString& iv, const QString& lv, bool installed, bool update) {
    Q_UNUSED(iv); Q_UNUSED(lv); Q_UNUSED(installed); Q_UNUSED(update);
}

void MainWindow::onLaunched(const QString& slug, bool ok, const QString& message) {
    if (m_activeJob != "launch" || m_activeSlug != slug) return;
    m_jobRunning = false;
    m_host->post(ok
        ? QJsonObject{{"t", "launchEvent"}, {"id", slug}, {"done", true}}
        : QJsonObject{{"t", "launchEvent"}, {"id", slug}, {"done", true}, {"failed", true}, {"text", message}});
}

void MainWindow::checkClientUpdate() {
    m_core->checkClientUpdate();
}

void MainWindow::onClientUpdateReady(const QString& installerPath) {
    // Never kill an install in flight: hold the swap until the platform job ends.
    m_pendingInstaller = installerPath;
    if (m_jobRunning) return;
    maybeSwapClientUpdate();
}
