#pragma once
#include <QObject>
#include <QNetworkAccessManager>
#include <QJsonObject>
#include <QJsonArray>
#include <QHash>
#include <atomic>
#include "Models.h"

class Worker : public QObject {
    Q_OBJECT
public:
    explicit Worker(QObject* parent = nullptr);
    ~Worker();

public slots:
    void run(const QString& job, const QString& slug);
    void cancel();
    void cancelClientUpdate() { if (m_inClientUpdate) m_cancelled = true; }

signals:
    void serverChecked(bool online, const QString& message);
    void catalogFetched(const QJsonArray& arr);
    void appState(const QString& slug, const QString& state, const QString& text);
    void appProgress(const QString& slug, int percent, const QString& file);
    void appLog(const QString& slug, const QString& line);
    void appInfo(const QString& slug, const QString& installedVersion, const QString& latestVersion, bool installed, bool updateAvailable);
    void payloadReady(const QString& slug, const QByteArray& payload, const QString& installDir);
    void licenseResult(bool valid, const QString& message);
    void licenseDetailsSignal(const QString& expiresIso, int daysRemaining);
    void licenseTokenCheckedSignal(bool valid, const QString& message);
    void launched(const QString& slug, bool success, const QString& message);
    void errorOccurred(const QString& slug, const QString& message);
    // Emitted once the newest installer passed download+hash verification
    // (installPath is a .exe ready to execute). The GUI quits and swaps.
    void clientUpdateReady(const QString& version, const QString& notes, const QString& installerPath);

private:
    struct Response { int status = 0; QByteArray body; bool ok = false; };    Response httpGet(const QUrl& url, const QString& accept = {});
    Response download(const QUrl& url, qint64 expected, const QString& slug,
                      const QString& fileLabel, QByteArray* out);
    // Streaming download with HTTP Range resume. Writes to destPath (kept as
    // destPath + ".part" until complete). Survives stalls/tunnel drops within
    // a few reconnect attempts. Returns ok=true when destPath exists and is final.
    Response downloadToFile(const QUrl& url, qint64 expected, const QString& slug,
                            const QString& fileLabel, const QString& destPath);
    QByteArray pubX() const;
    QByteArray pubY() const;
    QString serverUrl() const;
    QString licenseKey() const;
    QStringList candidateKeysFor(const QString& slug) const;
    QString installRoot() const;
    QString cacheRoot() const;
    QString appInstallDir(const CatalogEntry& e) const;
    bool verifyManifest(const QByteArray& raw, const QString& sigB64) const;
    bool loadCachedManifest(const QString& slug, Manifest& m) const;
    void saveCachedManifest(const Manifest& m) const;
    bool fetchManifest(const QString& slug, Manifest& m, bool& online);
    CatalogEntry entryFor(const QString& slug) const;
    bool prepareLocalStack(const CatalogEntry& e, const QString& slug);
    void fetchCatalog(bool emitEvent);
    bool fileMatches(const QString& path, const QString& sha) const;
    // Package (zip) files from the manifest that are absent or the wrong size on disk.
    QStringList missingPackageFiles(const Manifest& m, const QString& dir) const;
    bool payloadCached(const Manifest& m, const QString& slug, QByteArray& out) const;
    bool verifyPathSafe(const QString& rel, const QString& root, QString* absOut) const;
    // Version bookkeeping for updates: per-version manifest snapshots let an
    // update delete exactly the files the previous release owned.
    void saveManifestSnapshot(const Manifest& m) const;
    // Removes files tracked by the previous install's manifest that the new
    // manifest no longer contains. Hash-guarded: skips anything whose current
    // bytes differ from the old manifest (user may be using it).
    void cleanupStaleFiles(const QString& slug, const QString& fromVersion, const Manifest& latest, const QString& dir) const;

    // License helpers
    void jobActivate();
    void jobLicenseStatus();          // server lookup, never binds
    void jobCheckToken();             // local cached-token validation
    void jobClientUpdate();           // self-update check; downloads the new installer
    bool checkDecodedToken(const QJsonObject& body, QString* error);
    QString cachedToken() const;
    void saveCachedToken(const QString& token) const;
    void deleteCachedToken() const;

    QNetworkAccessManager* m_nam = nullptr;
    QHash<QString, CatalogEntry> m_catalog;
    std::atomic_bool m_cancelled{false};
    std::atomic_bool m_inClientUpdate{false};
};
