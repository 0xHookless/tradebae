#pragma once
#include <QString>

// Orchestrates the DeepCharts local data stack: the CQG MITM proxy (:443) and the
// historical-mock server (:12010), plus the hosts redirects and CA trust they need.
// Used by both DeepCharts (demo feed) and MotiveWave (prod api.cqg.com relay).
class DeepStack {
public:
    // True when appDir contains the DeepCharts proxy stack layout
    // (<appDir>/proxy/DeepChartsProxy/DeepChartsProxy.exe).
    static bool needsStack(const QString& appDir);

    // Terminates stack processes (proxy, history server, bridge) whose exe
    // lives inside appDir. Called before package updates so files the running
    // stack has locked can be replaced.
    static void stopStack(const QString& appDir);

    // Brings the stack fully up: hosts redirect, CA trust, hist server, proxy.
    // Non-blocking failures are reported through the returned status string:
    //   "ok"          - stack running (freshly started or already up)
    //   "already"     - both ports were already listening (assumed ours)
    //   "foreign"     - a third-party process owns 443/12010
    //   "missing"     - proxy bundles absent from appDir
    //   "start-failed" - bundle processes exited/silent, or port 443 reserved
    //                    by winnat (Hyper-V/WSL exclusion)
    //   "hosts-denied" - hosts file not writable (not running elevated)
    //   "ca-denied"   - cannot write the ProgramData certificate directory
    // When the status is not "ok", *detail (if non-null) gets a short
    // human-readable cause, typically including the newest engine log tail.
    static QString ensureStackIfInstalled(const QString& appDir,
                                          QString* detail = nullptr);
};
