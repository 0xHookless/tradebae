#include "WebViewHost.h"
#include <QStandardPaths>
#include <QDir>
#include <QJsonDocument>
#include <QJsonParseError>
#include <QUrl>
#include <QResizeEvent>
#include <wrl/event.h>

using namespace Microsoft::WRL;

namespace {
static QString toW(const QString& s) { return s; }

static QByteArray jsonBytes(const QJsonObject& o) {
    return QJsonDocument(o).toJson(QJsonDocument::Compact);
}
}

WebViewHost::WebViewHost(QWidget* parent) : QWidget(parent) {
    setAttribute(Qt::WA_NativeWindow);
    setAttribute(Qt::WA_DontCreateNativeAncestors);
    setAutoFillBackground(false);
}

void WebViewHost::loadHtml(const QString& htmlPath) {
    m_htmlPath = htmlPath;
}

// Returns the html to navigate to: the on-disk file when present (dev
// hot-edit), else the copy compiled into the exe via the Qt resource.
QString WebViewHost::resolveHtml(const QString& htmlPath) const {
    if (!htmlPath.isEmpty() && QFile::exists(htmlPath))
        return QUrl::fromLocalFile(htmlPath).toString();
    QFile r(QStringLiteral(":/app.html"));
    if (r.open(QIODevice::ReadOnly)) {
        const QByteArray data = r.readAll();
        if (!data.isEmpty())
            return QStringLiteral("data:text/html;charset=utf-8;base64,")
                + QString::fromLatin1(data.toBase64());
    }
    return htmlPath;
}

void WebViewHost::startCreate() {
    if (m_createStarted) return;
    m_createStarted = true;
    m_hwnd = reinterpret_cast<HWND>(winId());
    const QString dataRoot = QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);
    m_userDataDir = dataRoot + "/WebView2Data";
    QDir().mkpath(m_userDataDir);
    const std::wstring udata = m_userDataDir.toStdWString();
    CreateCoreWebView2EnvironmentWithOptions(nullptr, udata.c_str(), nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this](HRESULT err, ICoreWebView2Environment* env) -> HRESULT {
                m_env = env;
                attach();
                return S_OK;
            }).Get());
}

void WebViewHost::attach() {
    if (!m_env) return;
    m_env->CreateCoreWebView2Controller(m_hwnd,
        Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            [this](HRESULT err, ICoreWebView2Controller* controller) -> HRESULT {
                if (!controller) return S_OK;
                m_controller = controller;
                controller->get_CoreWebView2(&m_webview);
                if (m_webview) {
                    m_webview->add_WebMessageReceived(
                        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                            [this](ICoreWebView2* sender, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                            LPWSTR json = nullptr;
                            if (SUCCEEDED(args->get_WebMessageAsJson(&json)) && json) {
                                const QString qjson = QString::fromWCharArray(json);
                                CoTaskMemFree(json);
                                QJsonParseError perr{};
                                    const QJsonDocument doc = QJsonDocument::fromJson(qjson.toUtf8(), &perr);
                                    if (perr.error == QJsonParseError::NoError && doc.isObject())
                                        emit messageReceived(doc.object());
                                }
                                return S_OK;
                            }).Get(), nullptr);
                    if (!m_htmlPath.isEmpty()) {
                        const QString nav = resolveHtml(m_htmlPath);
                        m_webview->Navigate(reinterpret_cast<const wchar_t*>(nav.utf16()));
                    }
                }
                fit();
                const QVector<QJsonObject> pending = m_pending;
                m_pending.clear();
                for (const QJsonObject& o : pending)
                    m_webview->PostWebMessageAsJson(reinterpret_cast<const wchar_t*>(toW(QString::fromUtf8(jsonBytes(o))).utf16()));
                return S_OK;
            }).Get());
}

void WebViewHost::fit() {
    if (!m_controller) return;
    const RECT r{ 0, 0, width(), height() };
    m_controller->put_Bounds(r);
}

void WebViewHost::resizeEvent(QResizeEvent* ev) {
    QWidget::resizeEvent(ev);
    fit();
}

void WebViewHost::showEvent(QShowEvent* ev) {
    QWidget::showEvent(ev);
    startCreate();
    fit();
}

void WebViewHost::post(const QJsonObject& obj) {
    if (!m_webview) {
        if (m_pending.size() < 20) m_pending.append(obj);
        return;
    }
    const QString j = QString::fromUtf8(jsonBytes(obj));
    if (!j.isEmpty())
        m_webview->PostWebMessageAsJson(reinterpret_cast<const wchar_t*>(j.utf16()));
}

void WebViewHost::evalScript(const QString& js) {
    if (!m_webview) return;
    m_webview->ExecuteScript(reinterpret_cast<const wchar_t*>(js.utf16()), nullptr);
}
