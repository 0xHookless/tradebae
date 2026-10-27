#pragma once
#include <QObject>
#include <QThread>
#include <QHash>
#include <QList>
#include <QJsonArray>
#include <QByteArray>
#include "Models.h"

class Worker;

class LauncherCore : public QObject {
    Q_OBJECT
public:
    explicit LauncherCore(QObject* parent = nullptr);
    ~LauncherCore();

    QList<CatalogEntry> catalog() const { return m_catalog; }
    QString hwid() const;
    QString serverUrl() const;
    QString licenseKey() const;

    // Settings persistence. Does NOT trigger network activity.
    void saveSettings(const QString& serverUrl, const QString& licenseKey);

    // Explicit, button-driven actions only. Startup never calls these.
    void refreshCatalog();
    void activateLicense();
    void refreshLicenseStatus();   // server lookup, never binds a license
    void checkCachedToken();       // local cached-token validation, no network
    void checkApp(const QString& slug);
    void checkClientUpdate();
    void startApp(const QString& slug);
    void installApp(const QString& slug);   // download+verify+extract only, no launch
    void cancel();

signals:
    void serverStatus(bool online, const QString& message);
    void catalogChanged();
    void licenseStatus(bool valid, const QString& message);
    // expiry as ISO-8601 ("" when none/unknown), daysRemaining (-1 when unknown)
    void licenseDetails(const QString& expiresIso, int daysRemaining);
    void licenseTokenChecked(bool valid, const QString& message);
    void appStatus(const QString& slug, const QString& state, const QString& text);
    void appProgress(const QString& slug, int percent, const QString& file);
    void appLog(const QString& slug, const QString& line);
    void appInfo(const QString& slug, const QString& installedVersion, const QString& latestVersion, bool installed, bool updateAvailable);
    void launched(const QString& slug, bool success, const QString& message);
    void clientUpdateNeedsSwap(const QString& installerPath);

private slots:
    void onServerStatus(bool online, const QString& message);
    void onCatalog(const QJsonArray& arr);
    void onAppStatus(const QString& slug, const QString& state, const QString& text);
    void onAppProgress(const QString& slug, int percent, const QString& file);
    void onAppLog(const QString& slug, const QString& line);
    void onAppInfo(const QString& slug, const QString& installedVersion, const QString& latestVersion, bool installed, bool updateAvailable);
    void onLicense(bool valid, const QString& message);
    void onLicenseDetails(const QString& expiresIso, int daysRemaining);
    void onLicenseTokenChecked(bool valid, const QString& message);
    void onPayloadReady(const QString& slug, const QByteArray& payload, const QString& installDir);
    void onLaunched(const QString& slug, bool success, const QString& message);
    void onError(const QString& slug, const QString& message);

private:
    void dispatch(const QString& job, const QString& slug = {});
    QThread* m_thread = nullptr;
    Worker* m_worker = nullptr;
    QList<CatalogEntry> m_catalog;
};
