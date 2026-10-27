#include "LauncherCore.h"
#include "Worker.h"
#include "Crypto.h"
#include "Hardening.h"
#include "ReflectiveLoader.h"
#include <QSettings>
#include <QMetaObject>

LauncherCore::LauncherCore(QObject* parent) : QObject(parent) {
    m_thread = new QThread(this);
    m_worker = new Worker();
    m_worker->moveToThread(m_thread);

    connect(m_thread, &QThread::finished, m_worker, &QObject::deleteLater);
    connect(m_worker, &Worker::serverChecked, this, &LauncherCore::onServerStatus);
    connect(m_worker, &Worker::catalogFetched, this, &LauncherCore::onCatalog);
    connect(m_worker, &Worker::appState, this, &LauncherCore::onAppStatus);
    connect(m_worker, &Worker::appProgress, this, &LauncherCore::onAppProgress);
    connect(m_worker, &Worker::appLog, this, &LauncherCore::onAppLog);
    connect(m_worker, &Worker::appInfo, this, &LauncherCore::onAppInfo);
    connect(m_worker, &Worker::licenseResult, this, &LauncherCore::onLicense);
    connect(m_worker, &Worker::licenseDetailsSignal, this, &LauncherCore::onLicenseDetails);
    connect(m_worker, &Worker::licenseTokenCheckedSignal, this, &LauncherCore::onLicenseTokenChecked);
    connect(m_worker, &Worker::payloadReady, this, &LauncherCore::onPayloadReady);
    connect(m_worker, &Worker::launched, this, &LauncherCore::onLaunched);
    connect(m_worker, &Worker::clientUpdateReady, this, [&](const QString&, const QString&, const QString& path) {
        emit clientUpdateNeedsSwap(path);
    });
    connect(m_worker, &Worker::errorOccurred, this, &LauncherCore::onError);

    m_thread->start();
}

LauncherCore::~LauncherCore() {
    if (m_thread) {
        m_thread->quit();
        m_thread->wait(3000);
    }
}

QString LauncherCore::hwid() const { return Crypto::hwid(); }

QString LauncherCore::serverUrl() const {
    return QSettings().value("serverUrl", "http://127.0.0.1:8000").toString();
}

QString LauncherCore::licenseKey() const {
    return QSettings().value("licenseKey").toString();
}

void LauncherCore::saveSettings(const QString& serverUrl, const QString& licenseKey) {
    QSettings s;
    s.setValue("serverUrl", serverUrl.trimmed());
    s.setValue("licenseKey", licenseKey.trimmed());
}

void LauncherCore::dispatch(const QString& job, const QString& slug) {
    QMetaObject::invokeMethod(m_worker, "run", Qt::QueuedConnection,
                              Q_ARG(QString, job), Q_ARG(QString, slug));
}

void LauncherCore::refreshCatalog() { dispatch("catalog"); }
void LauncherCore::activateLicense() { dispatch("license"); }
void LauncherCore::refreshLicenseStatus() { dispatch("licenseStatus"); }
void LauncherCore::checkCachedToken() { dispatch("checkToken"); }
void LauncherCore::checkApp(const QString& slug) { dispatch("check", slug); }
void LauncherCore::checkClientUpdate() { dispatch("clientUpdate"); }
void LauncherCore::startApp(const QString& slug) { if (m_worker) m_worker->cancelClientUpdate(); dispatch("start", slug); }
void LauncherCore::installApp(const QString& slug) { if (m_worker) m_worker->cancelClientUpdate(); dispatch("install", slug); }
void LauncherCore::cancel() { if (m_worker) m_worker->cancel(); }

void LauncherCore::onServerStatus(bool online, const QString& message) {
    emit serverStatus(online, message);
}

void LauncherCore::onCatalog(const QJsonArray& arr) {
    m_catalog.clear();
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
        e.latestVersion = o.value("latest_version").toString();
        e.totalSize = static_cast<qint64>(o.value("total_size").toDouble());
        m_catalog.append(e);
    }
    emit catalogChanged();
    // Read-only inspection only: Worker 'check' never downloads or installs.
    // Note: UI computes install/update state directly from catalog vs QSettings; do not queue full-disk SHA scans on startup.
}

void LauncherCore::onAppStatus(const QString& slug, const QString& state, const QString& text) {
    emit appStatus(slug, state, text);
}
void LauncherCore::onAppProgress(const QString& slug, int percent, const QString& file) {
    emit appProgress(slug, percent, file);
}
void LauncherCore::onAppLog(const QString& slug, const QString& line) {
    emit appLog(slug, line);
}
void LauncherCore::onAppInfo(const QString& slug, const QString& installedVersion, const QString& latestVersion, bool installed, bool updateAvailable) {
    emit appInfo(slug, installedVersion, latestVersion, installed, updateAvailable);
}
void LauncherCore::onLicense(bool valid, const QString& message) {
    emit licenseStatus(valid, message);
}
void LauncherCore::onLicenseDetails(const QString& expiresIso, int daysRemaining) {
    emit licenseDetails(expiresIso, daysRemaining);
}
void LauncherCore::onLicenseTokenChecked(bool valid, const QString& message) {
    emit licenseTokenChecked(valid, message);
}

void LauncherCore::onPayloadReady(const QString& slug, const QByteArray& payloadRef, const QString& installDir) {
    QByteArray payload = payloadRef;  // copy so wiping below can't touch the queued original
    QString name = slug;
    for (const auto& e : m_catalog) if (e.slug == slug) name = e.displayName;
    emit appStatus(slug, "launching", "Launching " + name + "...");
    QString err;
    bool ok = ReflectiveLoader::loadAndRun(payload, installDir, &err);
    Hardening::wipe(payload);  // zero the in-memory plaintext after mapping
    if (ok) {
        emit launched(slug, true, "Application launched");
        emit appStatus(slug, "running", "Application running");
    } else {
        emit launched(slug, false, err);
        emit appStatus(slug, "failed", "Launch failed");
        emit appLog(slug, "Launch error: " + err);
    }
}

void LauncherCore::onLaunched(const QString& slug, bool success, const QString& message) {
    emit launched(slug, success, message);
}
void LauncherCore::onError(const QString& slug, const QString& message) {
    emit appLog(slug, "Error: " + message);
    emit appStatus(slug, "failed", message);
}
