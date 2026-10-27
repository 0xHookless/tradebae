#include <QApplication>
#include <QFont>
#include "MainWindow.h"

int main(int argc, char* argv[]) {
    QApplication app(argc, argv);
    QApplication::setOrganizationName("TradingPlatform");
    QApplication::setApplicationName("TradingLauncher");
    QApplication::setApplicationVersion("1.0.0");

    QFont f("Segoe UI", 9);
    QApplication::setFont(f);

    MainWindow w;
    w.show();
    return app.exec();
}
