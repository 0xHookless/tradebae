#pragma once
#include <QMainWindow>
#include <QJsonObject>
#include <QStringList>
#include <QElapsedTimer>
#include <QTimer>

class LauncherCore;
class WebViewHost;

class MainWindow : public QMainWindow {
    Q_OBJECT
public:
    explicit MainWindow(QWidget* parent = nullptr);

private slots:
    void onWebMessage(const QJsonObject& obj);

    void onServerStatus(bool online, const QString& message);
    void onCatalogChanged();
    void onLicense(bool valid, const QString& message);
    void onLicenseDetails(const QString& expiresIso, int daysRemaining);
    void onAppState(const QString& slug, const QString& state, const QString& text);
    void onAppProgress(const QString& slug, int percent, const QString& file);
    void onAppLog(const QString& slug, const QString& line);
    void onAppInfo(const QString& slug, const QString& installedVersion, const QString& latestVersion, bool installed, bool updateAvailable);
    void onLaunched(const QString& slug, bool ok, const QString& message);
    void onClientUpdateReady(const QString& installerPath);

private:
    void sendInit();
    QJsonObject catalogJson() const;
    QJsonObject licenseJson() const;
    void sendCatalog();
    void sendUpdateState();
    void probeServer(int seq);
    void replyProbe(bool ok);
    void postInstallEvent(const QString& phase, const QJsonObject& extra);
    void pumpInstall(const QString& slug, const QString& state, const QString& text);
    void stepLaunch(const QString& slug, int stepIdx, const QString& label);
    void maybeSwapClientUpdate();
    void checkClientUpdate();
    QString installRoot() const;
    QString entryExe(const QString& slug) const;

    LauncherCore* m_core = nullptr;
    WebViewHost* m_host = nullptr;
    bool m_webReady = false;
    bool m_initSent = false;

    QString m_activeJob;
    QString m_activeSlug;
    bool m_jobRunning = false;
    bool m_bootWindow = true;
    QString m_pendingInstaller;
    QTimer* m_clientUpdateTimer = nullptr;
    QStringList m_launchSteps;
    int m_lastStep = -1;
    QElapsedTimer m_stepTimer;

    int m_probeSeq = 0;
    bool m_probePending = false;
    QElapsedTimer m_probeTimer;
    int m_actSeq = 0;
};
