#pragma once
#include <QString>
#include <QJsonObject>
#include <QList>

struct ManifestFile {
    QString relativePath;
    qint64 size = 0;
    QString sha256;
    QString role = "normal";
    bool required = true;
};

struct Manifest {
    QString appId;
    QString displayName;
    QString version;
    int manifestVersion = 1;
    qint64 totalSize = 0;
    QList<ManifestFile> files;
    QByteArray raw;
    QString signature;
    QString zip_sha256;
    qint64 zip_size = 0;

    bool valid() const { return !appId.isEmpty() && !version.isEmpty() && !raw.isEmpty(); }
};

struct CatalogEntry {
    QString slug;
    QString displayName;
    QString description;
    QString iconUrl;
    QString installDirName;
    QString executableName;
    QString launchArgs;
    bool separateExecutable = false;
    QString launchMode;     // "" = reflective for separate executable apps, "ghost" = self-deleting copy launch
    bool localStack = false; // needs the DeepCharts local data stack (proxy + hist + hosts)
    QString latestVersion;
    qint64 totalSize = 0;
};
