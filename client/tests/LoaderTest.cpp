#include <QCoreApplication>
#include <QFile>
#include <QByteArray>
#include <QString>
#include <QThread>
#include <cstdio>
#include "ReflectiveLoader.h"

int main(int argc, char* argv[]) {
    QCoreApplication app(argc, argv);
    if (argc < 2) { std::printf("usage: LoaderTest <pe-file>\n"); return 2; }
    QFile f(QString::fromLocal8Bit(argv[1]));
    if (!f.open(QIODevice::ReadOnly)) { std::printf("cannot open payload\n"); return 3; }
    QByteArray pe = f.readAll();
    f.close();
    QString err;
    bool ok = ReflectiveLoader::loadAndRun(pe, QStringLiteral("C:/TradingPlatform/testdata"), &err);
    std::printf("loadAndRun=%d error=%s\n", ok ? 1 : 0, err.toLocal8Bit().constData());
    QThread::msleep(2500);
    return ok ? 0 : 4;
}
