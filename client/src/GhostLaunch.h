#pragma once
#include <QString>
#include <QByteArray>

// Ghost launch: run a managed payload ("the main exe never persists on disk")
// by placing a hidden, randomly-named transient copy of the payload (plus a
// copy of its .exe.config so the CLR keeps its binding redirects) inside the
// app's install directory and starting it from there.
//
// Why a transient copy instead of an immediate unlink: the .NET Framework
// runtime opens the running exe (and its .config) by path during startup, so
// the image path must stay openable while the process lives. The copy is
// invisible in Explorer (hidden attribute, random name), never ships in the
// package, is never stored outside the DPAPI-encrypted payload cache, and is
// swept automatically on the next launch/sweep — a still-running instance's
// files are detected via its process image path and left alone.
namespace GhostLaunch {

// Start the payload as a ghost copy. Returns true if the process started.
// payloadName is the manifest relative_path of the payload (e.g.
// "Deepchart.Core.exe") and is used to locate the .exe.config next to it in
// the install directory.
bool launch(const QByteArray& payload,
            const QString& payloadName,
            const QString& installDir,
            const QString& args,
            QString* errorMessage = nullptr);

// Remove ghost leftovers from previous runs that are not in active use.
void sweep(const QString& installDir);

}  // namespace GhostLaunch
