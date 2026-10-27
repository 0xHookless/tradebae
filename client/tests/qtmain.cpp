#include <QApplication>
#include <QWidget>
#include <QVBoxLayout>
#include <QFile>
#include "WebViewHost.h"

int main(int argc, char** argv) {
    QApplication app(argc, argv);

    QWidget w;
    w.setWindowTitle("Wv2QtTest");
    w.resize(900, 600);

    auto* host = new WebViewHost(&w);
    auto* lay = new QVBoxLayout(&w);
    lay->setContentsMargins(0, 0, 0, 0);
    lay->addWidget(host);
    QString html = QCoreApplication::applicationDirPath() + "/app.html";
    if (!QFile::exists(html))
        html = "C:/TradingPlatform/client/build/Release/app.html";
    host->loadHtml(html);

    w.show();
    return app.exec();
}
