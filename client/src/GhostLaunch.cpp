#include "GhostLaunch.h"

#include <windows.h>
#include <psapi.h>

#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QUuid>
#include <QSet>

#include <string>

namespace {

QString randomGhostBase() {
    const QString u = QUuid::createUuid().toString(QUuid::WithoutBraces);
    QString hex;
    for (QChar c : u) {
        if (c.isLetterOrNumber() && c != '-') hex += c;
        if (hex.length() >= 20) break;
    }
    return "tpghost_" + hex;
}

// Collect the image paths of every running process we can read. Used so the
// sweep never removes files belonging to an instance that is still alive.
QSet<QString> runningImagePaths() {
    QSet<QString> out;
    DWORD* pids = nullptr;
    DWORD cb = 4096, returned = 0;
    for (int attempt = 0; attempt < 4; ++attempt) {
        delete[] pids;
        pids = reinterpret_cast<DWORD*>(new unsigned char[cb]);
        if (!EnumProcesses(pids, cb, &returned)) break;
        if (returned < cb) break;
        cb *= 2;
    }
    if (!pids) return out;
    const DWORD count = returned / sizeof(DWORD);
    for (DWORD i = 0; i < count; ++i) {
        if (!pids[i]) continue;
        HANDLE h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pids[i]);
        if (!h) continue;
        WCHAR path[MAX_PATH * 2] = {};
        DWORD sz = MAX_PATH * 2;
        if (GetModuleFileNameExW(h, nullptr, path, sz)) {
            out.insert(QString::fromWCharArray(path).toLower());
        }
        CloseHandle(h);
    }
    delete[] pids;
    return out;
}

bool fileInUse(const QString& path, const QSet<QString>& running) {
    const QString low = path.toLower();
    if (running.contains(low)) return true;
    // A currently-running ghost exe has its .config read by the CLR; treat
    // "<ghost>.exe.config" as in use whenever "<ghost>.exe" is running.
    if (low.endsWith(".exe.config")) {
        const QString exe = low.left(low.length() - QString(".config").length());
        if (running.contains(exe)) return true;
    }
    return false;
}

}  // namespace

namespace GhostLaunch {

void sweep(const QString& installDir) {
    QDir dir(installDir);
    if (!dir.exists()) return;
    const QSet<QString> running = runningImagePaths();
    for (const QFileInfo& fi :
         dir.entryInfoList(QStringList() << "tpghost_*",
                           QDir::Files | QDir::Hidden)) {
        if (fileInUse(fi.absoluteFilePath(), running)) continue;
        QFile::remove(fi.absoluteFilePath());
    }
}

bool launch(const QByteArray& payload,
            const QString& payloadName,
            const QString& installDir,
            const QString& args,
            QString* errorMessage) {
    auto fail = [&](const QString& msg) {
        if (errorMessage) *errorMessage = msg;
        return false;
    };

    sweep(installDir);
    QDir dir(installDir);
    if (!dir.mkpath(".")) return fail("Install directory is not writable");

    const QString base = randomGhostBase();
    const QString exePath = installDir + "/" + base + ".exe";
    const QString configPath = exePath + ".config";

    // Resolve the payload's real location (relativePath may be nested, e.g.
    // "app/Deepchart.Core.exe"). The ghost exe is written at the install root;
    // its working directory and .exe.config come from the payload's folder so
    // relative folders (Resources/, sounds/, runtime dlls) resolve as usual.
    QString relDir;
    QString payloadBase;
    if (!payloadName.isEmpty()) {
        const QString rel = QString(payloadName).replace('\\', '/');
        const int slash = rel.indexOf('/');
        if (slash > 0) relDir = rel.left(slash);
        const QFileInfo pf(rel);
        payloadBase = pf.completeBaseName();
    }
    QString workDir = installDir;
    if (!relDir.isEmpty()) {
        const QDir sub(installDir + "/" + relDir);
        if (sub.exists()) workDir = sub.absolutePath();
    }

    // Copy the payload's original .exe.config beside the ghost exe so CLR
    // binding redirects and startup settings keep working under the random name.
    if (!payloadBase.isEmpty()) {
        QString srcConfig = installDir + "/" + (relDir.isEmpty() ? QString() : relDir + "/")
                            + payloadBase + ".exe.config";
        srcConfig = QDir(installDir).absoluteFilePath(srcConfig);
        if (QFile::exists(srcConfig)) {
            QFile::copy(srcConfig, configPath);
            SetFileAttributesW(reinterpret_cast<const wchar_t*>(configPath.utf16()),
                               FILE_ATTRIBUTE_HIDDEN);
        }
    }

    // Write the ghost exe. Plain visible-to-loader file; hidden attribute.
    QFile out(exePath);
    if (!out.open(QIODevice::WriteOnly) || out.write(payload) != payload.size()) {
        out.remove();
        return fail("Cannot write the application");
    }
    out.close();
    SetFileAttributesW(reinterpret_cast<const wchar_t*>(exePath.utf16()),
                       FILE_ATTRIBUTE_HIDDEN);

    // Start it. Working directory mirrors the payload's own folder (install
    // root for root-level payloads, the nested folder for e.g. app/...).
    QString cmd = "\"" + exePath + "\"";
    if (!args.trimmed().isEmpty()) cmd += " " + args.trimmed();

    STARTUPINFOW si;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    PROCESS_INFORMATION pi;
    ZeroMemory(&pi, sizeof(pi));

    std::wstring cmdLine = cmd.toStdWString();
    std::wstring workDirW = workDir.toStdWString();
    const bool ok = CreateProcessW(nullptr, cmdLine.data(), nullptr, nullptr, FALSE, CREATE_UNICODE_ENVIRONMENT, nullptr, workDirW.c_str(), &si, &pi);

    if (!ok) {
        const DWORD err = GetLastError();
        QFile::remove(exePath);
        QFile::remove(configPath);
        return fail("Failed to start the application (error " +
                    QString::number(err) + ")");
    }
    CloseHandle(pi.hThread);
    CloseHandle(pi.hProcess);
    return true;
}

}  // namespace GhostLaunch
