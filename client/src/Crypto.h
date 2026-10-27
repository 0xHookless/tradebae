#pragma once
#include <QString>
#include <QByteArray>

namespace Crypto {
    QByteArray sha256Bytes(const QByteArray& data);
    QByteArray sha256File(const QString& path, QString* error = nullptr);
    QByteArray base64Decode(const QString& s);
    QByteArray base64UrlDecode(const QString& s);
    bool ecdsaVerify(const QByteArray& data, const QByteArray& sig64,
                     const QByteArray& pubX, const QByteArray& pubY);
    QString hwid();
    QList<QPair<QString,QString>> hwidComponents();
    bool dpapiProtect(const QByteArray& plain, QByteArray& out);
    bool dpapiUnprotect(const QByteArray& blob, QByteArray& out);
}
