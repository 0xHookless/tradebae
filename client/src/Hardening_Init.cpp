#include "Hardening.h"
#include "TPConfig.h"
#include <psapi.h>
#include <QStandardPaths>
#include <QCoreApplication>
#include <QSet>

#pragma comment(lib, "psapi.lib")

namespace Hardening {

// Compiled-time encoded setting names: only XOR-able with a fixed key derived
// from the deployment salt, raising the bar above naive string dumps.
static const char kSettingServerUrl[] = {
    static_cast<char>(0x33), static_cast<char>(0x2d), static_cast<char>(0x35), 0x35, 0x39, 0x58, 0x1d, 0x00
};
static const char kSettingLicenseKey[] = {
    static_cast<char>(0x2c), static_cast<char>(0x28), static_cast<char>(0x2c), 0x2b, 0x1b, 0x2a, 0x5d, 0x00
};

const char SETTING_SERVER_URL[]  = { static_cast<char>(kSettingServerUrl[0]) ^ TP_HWID_SALT[0],
                                     static_cast<char>(kSettingServerUrl[1]) ^ TP_HWID_SALT[1], 0 };
const char SETTING_LICENSE_KEY[] = { static_cast<char>(kSettingLicenseKey[0]) ^ TP_HWID_SALT[2],
                                     static_cast<char>(kSettingLicenseKey[1]) ^ TP_HWID_SALT[3], 0 };

} // namespace Hardening
