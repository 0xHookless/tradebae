#include <QCoreApplication>
#include <QTimer>
#include <QSettings>
#include <QDebug>
#include <QFile>
#include <cstring>
#include "LauncherCore.h"

int main(int argc, char* argv[]) {
    QCoreApplication app(argc, argv);
    QCoreApplication::setOrganizationName("TradingPlatform");
    QCoreApplication::setApplicationName("TradingLauncher");

    bool gateMode = false;
    int argCount = argc;
    for (int i = 0; i < argc; ++i) if (std::strcmp(argv[i], "--gate") == 0) { gateMode = true; }
    (void)argCount;
    if (argc < 3) { qWarning() << "usage: ClientFlowTest <serverUrl> <licenseKey> [--gate]"; return 2; }
    QSettings s;
    s.setValue("serverUrl", QString::fromLocal8Bit(argv[1]));
    s.setValue("licenseKey", QString::fromLocal8Bit(argv[2]));

    LauncherCore core;
    QString slug = (argc > 3 && !gateMode) ? QString::fromLocal8Bit(argv[3]) : "sierra-chart";
    bool started = false;

    if (gateMode) {
        // Gate test: no cached token may exist. startApp must fail with no
        // downloads, no installs, and no launch.
        s.remove("licenseToken");
        s.remove("licenseKey");
        s.sync();
        bool failed = false;
        QObject::connect(&core, &LauncherCore::appLog, [](const QString& sl, const QString& line) {
            qInfo().noquote() << "[" << sl << "] " << line;
        });
        QObject::connect(&core, &LauncherCore::appStatus, [&](const QString& sl, const QString& state, const QString& text) {
            qInfo().noquote() << "STATE" << sl << state << text;
            if (state == "failed" && text.contains("license", Qt::CaseInsensitive)) {
                failed = true;
                qInfo() << "GATE HELD: startApp refused without a valid license";
                QTimer::singleShot(300, &app, [&app]() { app.exit(0); });
            }
        });
        QObject::connect(&core, &LauncherCore::launched, [&](const QString& sl, bool ok, const QString& msg) {
            qInfo().noquote() << "LAUNCHED(unexpected)" << sl << ok << msg;
            qWarning() << "FAIL: application launched without a valid license";
            QTimer::singleShot(300, &app, [&app]() { app.exit(7); });
        });
        QTimer::singleShot(120000, &app, [&app, &failed]() {
            if (failed) { app.exit(0); return; }
            qWarning() << "timeout waiting for gate refusal"; app.exit(6);
        });
        QTimer::singleShot(0, &core, [&core, &slug, &started]() {
            started = true; core.startApp(slug);
        });
        return app.exec();
    }

    QObject::connect(&core, &LauncherCore::appLog, [](const QString& sl, const QString& line) {
        qInfo().noquote() << "[" << sl << "] " << line;
    });
    QObject::connect(&core, &LauncherCore::appProgress, [](const QString& sl, int pct, const QString& file) {
        qInfo().noquote() << "PROGRESS" << sl << pct << file;
    });
    QObject::connect(&core, &LauncherCore::appStatus, [&](const QString& sl, const QString& state, const QString& text) {
        qInfo().noquote() << "STATE" << sl << state << text;
    });
    QObject::connect(&core, &LauncherCore::catalogChanged, [&]() {
        if (started) return;
        started = true;
        qInfo() << "catalog loaded; starting" << slug;
        core.startApp(slug);
    });
    QTimer::singleShot(0, &core, [&core]() { core.refreshCatalog(); });
    QTimer::singleShot(5000, &core, [&]() {
        if (started) return;
        started = true;
        qInfo() << "starting without catalog (offline path)" << slug;
        core.startApp(slug);
    });
    QObject::connect(&core, &LauncherCore::launched, [&](const QString& sl, bool ok, const QString& msg) {
        qInfo().noquote() << "LAUNCHED" << sl << ok << msg;
        QTimer::singleShot(500, &app, [&app, ok]() { app.exit(ok ? 0 : 5); });
    });

    QTimer::singleShot(3600000, &app, [&app]() { qWarning() << "timeout"; app.exit(6); });
    return app.exec();
}
