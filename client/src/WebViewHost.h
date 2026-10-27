#pragma once
#include <QWidget>
#include <QJsonObject>
#include <QVector>

#include <windows.h>
#include <wrl/client.h>
#include "include/WebView2.h"

namespace wrl = Microsoft::WRL;

// Host window that renders the Trade Bay HTML with WebView2 and bridges
// messages between the web UI and the native launcher.
class WebViewHost : public QWidget {
    Q_OBJECT
public:
    explicit WebViewHost(QWidget* parent = nullptr);

    void loadHtml(const QString& htmlPath);

    void post(const QJsonObject& obj);          // native -> JS (PostWebMessageAsJson)
    void evalScript(const QString& js);         // native -> JS (ExecuteScript)

private:
    QString resolveHtml(const QString& htmlPath) const;
    void startCreate();

signals:
    void messageReceived(const QJsonObject& obj);

private:
    void attach();
    void fit();

protected:
    void resizeEvent(QResizeEvent* event) override;
    void showEvent(QShowEvent* event) override;

    HWND m_hwnd = nullptr;
    wrl::ComPtr<ICoreWebView2Environment> m_env;
    wrl::ComPtr<ICoreWebView2Controller> m_controller;
    wrl::ComPtr<ICoreWebView2> m_webview;
    QString m_htmlPath;
    QString m_userDataDir;
    QVector<QJsonObject> m_pending;
    bool m_createStarted = false;
};
