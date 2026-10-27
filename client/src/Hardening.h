#pragma once
#include <QString>
#include <QByteArray>
#include <windows.h>

namespace Hardening {
    // Time-of-use string deobfuscation. Call sites store literals already
    // encoded (see SETTING_* keys below). NOT a security boundary by itself.
    QString xorDeobf(const QByteArray& encoded, unsigned char key);
    QByteArray xorEncode(const QByteArray& plain, unsigned char key);

    // Deployment identity tag kept obfuscated so it isn't a trivial string scan.
    // Backed by TP_HWID_SALT bits in the compiled binary.
    extern const char SETTING_SERVER_URL[];
    extern const char SETTING_LICENSE_KEY[];

    void wipe(QByteArray& buffer);
    void eraseOwnHeader();

    // Anti-DLL-injection: scan all loaded modules; returns count of suspicious ones.
    int scanForeignDlls(QStringList* names = nullptr);
}
