#include "Hardening.h"
#include <psapi.h>
#include <QStandardPaths>
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QSet>

#pragma comment(lib, "psapi.lib")

namespace Hardening {

QByteArray xorEncode(const QByteArray& plain, unsigned char key) {
    QByteArray out = plain;
    for (int i = 0; i < out.size(); ++i)
        out[i] = static_cast<char>(out[i] ^ static_cast<char>(key + static_cast<unsigned char>(i)));
    return out;
}

QString xorDeobf(const QByteArray& encoded, unsigned char key) {
    QByteArray out = encoded;
    for (int i = 0; i < out.size(); ++i)
        out[i] = static_cast<char>(out[i] ^ static_cast<char>(key + static_cast<unsigned char>(i)));
    return QString::fromUtf8(out);
}

void wipe(QByteArray& buffer) {
    if (buffer.isNull() || buffer.isEmpty()) return;
    SecureZeroMemory(buffer.data(), static_cast<SIZE_T>(buffer.size()));
}

void eraseOwnHeader() {
    HMODULE self = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT |
                       GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
                       reinterpret_cast<LPCWSTR>(&eraseOwnHeader), &self);
    if (!self) return;
    DWORD old = 0;
    if (VirtualProtect(self, 0x1000, PAGE_READWRITE, &old)) {
        SecureZeroMemory(self, 0x1000);
        VirtualProtect(self, 0x1000, old, &old);
    }
}

int scanForeignDlls(QStringList* names) {
    HMODULE mods[2048]{};
    DWORD needed = 0;
    if (!EnumProcessModules(GetCurrentProcess(), mods, sizeof(mods), &needed))
        return -1;
    int count = needed / sizeof(HMODULE);
    if (count > 2048) count = 2048;

    QSet<QString> okPrefixes;
    okPrefixes.insert(QStringLiteral("c:\\windows"));
    okPrefixes.insert(QStringLiteral("c:\\qt"));
    const QString appData = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation).toLower();
    const QString appDir = QCoreApplication::applicationDirPath().toLower();
    if (!appData.isEmpty()) okPrefixes.insert(appData);
    if (!appDir.isEmpty()) okPrefixes.insert(appDir);

    int suspicious = 0;
    wchar_t path[MAX_PATH + 1]{};
    for (int i = 0; i < count; ++i) {
        DWORD n = GetModuleFileNameExW(GetCurrentProcess(), mods[i], path, MAX_PATH);
        if (!n) continue;
        QString p = QString::fromWCharArray(path).toLower();
        bool allowed = false;
        for (const QString& prefix : okPrefixes) {
            if (!prefix.isEmpty() && p.startsWith(prefix)) { allowed = true; break; }
        }
        if (!allowed) {
            if (names) names->append(p);
            ++suspicious;
        }
    }
    return suspicious;
}

}
