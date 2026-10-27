#pragma once
#include <QByteArray>
#include <QString>

namespace ReflectiveLoader {
    // Maps a 64-bit PE image into this process and invokes its entry point in a
    // new thread. The image remains resident for the lifetime of the process.
    bool loadAndRun(const QByteArray& pe, const QString& workingDir, QString* error);
}
