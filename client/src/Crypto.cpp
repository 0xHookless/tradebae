#include "Crypto.h"
#include <QCryptographicHash>
#include <QFile>
#include <QString>
#include <windows.h>
#include <bcrypt.h>
#include <dpapi.h>
#include <QSettings>
#include <QRegularExpression>
#include <QLibraryInfo>
#include "TPConfig.h"
#include <QList>
#include <QPair>

#pragma comment(lib, "bcrypt.lib")
#pragma comment(lib, "crypt32.lib")
#pragma comment(lib, "advapi32.lib")

QByteArray Crypto::sha256Bytes(const QByteArray& data) {
    return QCryptographicHash::hash(data, QCryptographicHash::Sha256);
}

QByteArray Crypto::sha256File(const QString& path, QString* error) {
    QFile f(path);
    if (!f.open(QIODevice::ReadOnly)) {
        if (error) *error = QStringLiteral("Cannot open file: %1").arg(f.errorString());
        return {};
    }
    QCryptographicHash h(QCryptographicHash::Sha256);
    if (!h.addData(&f)) {
        if (error) *error = QStringLiteral("Failed to read file");
        return {};
    }
    return h.result();
}

static QByteArray b64decodeImpl(const QString& s, bool url) {
    QByteArray in = s.toLatin1();
    in = in.replace('-', '+').replace('_', '/');
    int pad = (4 - (in.size() % 4)) % 4;
    in.append(QByteArray(pad, '='));
    return QByteArray::fromBase64(in);
}

QByteArray Crypto::base64Decode(const QString& s) { return b64decodeImpl(s, false); }
QByteArray Crypto::base64UrlDecode(const QString& s) { return b64decodeImpl(s, true); }

bool Crypto::ecdsaVerify(const QByteArray& data, const QByteArray& sig64,
                         const QByteArray& pubX, const QByteArray& pubY) {
    if (pubX.size() != 32 || pubY.size() != 32 || sig64.size() != 64) return false;
    BCRYPT_ALG_HANDLE alg = nullptr;
    BCRYPT_KEY_HANDLE key = nullptr;
    bool ok = false;
    if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_ECDSA_P256_ALGORITHM, nullptr, 0) != 0) return false;

    struct Blob {
        BCRYPT_ECCKEY_BLOB header;
        BYTE x[32];
        BYTE y[32];
    } blob;
    blob.header.dwMagic = BCRYPT_ECDSA_PUBLIC_P256_MAGIC;
    blob.header.cbKey = 32;
    memcpy(blob.x, pubX.constData(), 32);
    memcpy(blob.y, pubY.constData(), 32);

    if (BCryptImportKeyPair(alg, nullptr, BCRYPT_ECCPUBLIC_BLOB, &key,
                            reinterpret_cast<PUCHAR>(&blob), sizeof(blob), 0) == 0) {
        QByteArray digest = QCryptographicHash::hash(data, QCryptographicHash::Sha256);
        NTSTATUS st = BCryptVerifySignature(key, nullptr,
                                            reinterpret_cast<PUCHAR>(digest.data()), digest.size(),
                                            reinterpret_cast<PUCHAR>(const_cast<char*>(sig64.constData())),
                                            sig64.size(), 0);
        ok = (st == 0);
    }
    if (key) BCryptDestroyKey(key);
    if (alg) BCryptCloseAlgorithmProvider(alg, 0);
    return ok;
}

QList<QPair<QString,QString>> Crypto::hwidComponents() {
    QList<QPair<QString,QString>> parts;

    // 1. MachineGuid (per-machine install GUID from Windows cryptography setup)
    QString machineGuid;
    HKEY hk = nullptr;
    if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Cryptography", 0,
                      KEY_READ | KEY_WOW64_64KEY, &hk) == ERROR_SUCCESS) {
        wchar_t buf[256]{};
        DWORD size = sizeof(buf) - sizeof(wchar_t);
        DWORD type = 0;
        if (RegQueryValueExW(hk, L"MachineGuid", nullptr, &type,
                             reinterpret_cast<LPBYTE>(buf), &size) == ERROR_SUCCESS) {
            machineGuid = QString::fromWCharArray(buf);
        }
        RegCloseKey(hk);
    }
    if (machineGuid.isEmpty()) machineGuid = qEnvironmentVariable("COMPUTERNAME");
    parts.append({"guid", machineGuid});

    // 2. Volume serial of the drive Windows boots from
    wchar_t sysDir[MAX_PATH]{};
    GetSystemDirectoryW(sysDir, MAX_PATH);
    QString sysDrive = QString::fromWCharArray(sysDir).left(3);
    DWORD volSerial = 0;
    GetVolumeInformationW(reinterpret_cast<LPCWSTR>(sysDrive.utf16()),
                          nullptr, 0, &volSerial, nullptr, nullptr, nullptr, 0);
    parts.append({"volume", QStringLiteral("%1:%2").arg(sysDrive).arg(volSerial, 8, 16, QLatin1Char('0'))});

    // 3. CPU identifier
    parts.append({"cpu", qEnvironmentVariable("PROCESSOR_IDENTIFIER")});
    return parts;
}

QString Crypto::hwid() {
    QString composite = QStringLiteral("TPv%1|%2|").arg(TP_HWID_FORMAT).arg(TP_HWID_SALT);
    for (const auto& part : hwidComponents())
        composite += part.first + QLatin1Char('=') + part.second + QLatin1Char('|');
    return QString::fromLatin1(QCryptographicHash::hash(composite.toUtf8(), QCryptographicHash::Sha256).toHex());
}

bool Crypto::dpapiProtect(const QByteArray& plain, QByteArray& out) {
    DATA_BLOB in, res;
    in.pbData = reinterpret_cast<BYTE*>(const_cast<char*>(plain.constData()));
    in.cbData = static_cast<DWORD>(plain.size());
    if (CryptProtectData(&in, L"TradingLauncher", nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &res)) {
        out = QByteArray(reinterpret_cast<char*>(res.pbData), static_cast<int>(res.cbData));
        LocalFree(res.pbData);
        return true;
    }
    return false;
}

bool Crypto::dpapiUnprotect(const QByteArray& blob, QByteArray& out) {
    DATA_BLOB in, res;
    in.pbData = reinterpret_cast<BYTE*>(const_cast<char*>(blob.constData()));
    in.cbData = static_cast<DWORD>(blob.size());
    if (CryptUnprotectData(&in, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &res)) {
        out = QByteArray(reinterpret_cast<char*>(res.pbData), static_cast<int>(res.cbData));
        LocalFree(res.pbData);
        return true;
    }
    return false;
}
