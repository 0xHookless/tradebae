#include <windows.h>
#include <wrl/client.h>
#include <wrl/event.h>
#include "include/WebView2.h"
#include <cstdio>

using namespace Microsoft::WRL;

int wWinMain(HINSTANCE hInst, HINSTANCE, LPWSTR, int) {
    FILE* f = nullptr;
    freopen_s(&f, "C:\\Users\\hawdi\\AppData\\Local\\Temp\\opencode\\wv2test.log", "w", stdout);

    HWND hwnd = CreateWindowExW(0, L"STATIC", L"wv2test", WS_OVERLAPPEDWINDOW,
                                100, 100, 900, 600, nullptr, nullptr, hInst, nullptr);
    ShowWindow(hwnd, SW_SHOW);

    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        nullptr, L"C:\\Users\\hawdi\\AppData\\Local\\Temp\\opencode\\wv2udata", nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [hwnd](HRESULT error, ICoreWebView2Environment* env) -> HRESULT {
                fprintf(stdout, "env created hr=0x%08X err=0x%08X\n", error, 0u);
                fflush(stdout);
                if (!env) return E_FAIL;
                return env->CreateCoreWebView2Controller(hwnd,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [](HRESULT error2, ICoreWebView2Controller* c) -> HRESULT {
                            fprintf(stdout, "controller hr=0x%08X ptr=%p\n", error2, (void*)c);
                            fflush(stdout);
                            if (!c) return S_OK;
                            ICoreWebView2* wv = nullptr;
                            c->get_CoreWebView2(&wv);
                            fprintf(stdout, "webview=%p\n", (void*)wv);
                            fflush(stdout);
                            if (wv) {
                                wv->add_WebMessageReceived(
                                    Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                        [](ICoreWebView2* s, ICoreWebView2WebMessageReceivedEventArgs* a) -> HRESULT {
                                            return S_OK;
                                        }).Get(), nullptr);
                                wv->Navigate(L"file:///C:/TradingPlatform/client/build/Release/app.html");
                            }
                            return S_OK;
                        }).Get());
            }).Get());
    fprintf(stdout, "CreateEnv returned 0x%08X\n", hr);
    fflush(stdout);

    MSG msg;
    while (GetMessageW(&msg, nullptr, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    return 0;
}
