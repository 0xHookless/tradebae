cmake_minimum_required(VERSION 3.21)
project(TradingLauncher VERSION 1.3.0 LANGUAGES CXX)

add_compile_definitions(TP_CLIENT_VERSION="1.4.3")

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets Network)

add_executable(TradingLauncher WIN32
    src/main.cpp
    src/MainWindow.cpp
    src/MainWindow.h
    src/WebViewHost.cpp
    src/WebViewHost.h
    src/LauncherCore.cpp
    src/LauncherCore.h
    src/Worker.cpp
    src/Worker.h
    src/Crypto.cpp
    src/Crypto.h
    src/ReflectiveLoader.cpp
    src/ReflectiveLoader.h
    src/GhostLaunch.cpp
    src/GhostLaunch.h
    src/DeepStack.cpp
    src/DeepStack.h
    src/Hardening.cpp
    src/Hardening.h
    src/Models.h
    src/ClientKeys.h
    src/TPConfig.h
    src/tp.qrc
)

target_include_directories(TradingLauncher PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2
)
target_link_libraries(TradingLauncher PRIVATE
    Qt6::Widgets
    Qt6::Network
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2/lib/x64/WebView2Loader.dll.lib
    bcrypt
    crypt32
    advapi32
    psapi
    shell32
)

# Deploy the WebView2 loader and UI assets next to the executable
add_custom_command(TARGET TradingLauncher POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2/lib/x64/WebView2Loader.dll"
        $<TARGET_FILE_DIR:TradingLauncher>/WebView2Loader.dll
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/src/html/app.html"
        $<TARGET_FILE_DIR:TradingLauncher>/app.html
    COMMENT "Deploying WebView2 loader and UI")

# Deploy Qt runtime next to the executable on Windows builds
if (WIN32)
    find_program(WINDEPLOYQT_EXE windeployqt HINTS "${QT6_INSTALL_PREFIX}/bin" "${CMAKE_PREFIX_PATH}/bin")
    if (WINDEPLOYQT_EXE)
        add_custom_command(TARGET TradingLauncher POST_BUILD
            COMMAND "${WINDEPLOYQT_EXE}" --no-translations --no-system-d3d-compiler "$<TARGET_FILE:TradingLauncher>"
            COMMENT "Deploying Qt runtime")
    endif()
endif()

add_executable(LoaderTest tests/LoaderTest.cpp src/ReflectiveLoader.cpp src/ReflectiveLoader.h)
target_link_libraries(LoaderTest PRIVATE Qt6::Core)
target_include_directories(LoaderTest PRIVATE src)


add_executable(ClientFlowTest tests/ClientFlowTest.cpp src/LauncherCore.cpp src/LauncherCore.h src/Worker.cpp src/Worker.h src/Crypto.cpp src/Crypto.h src/ReflectiveLoader.cpp src/ReflectiveLoader.h src/GhostLaunch.cpp src/GhostLaunch.h src/DeepStack.cpp src/DeepStack.h src/Hardening.cpp src/Hardening.h src/Models.h src/ClientKeys.h src/TPConfig.h)
target_include_directories(ClientFlowTest PRIVATE src)
target_link_libraries(ClientFlowTest PRIVATE Qt6::Core Qt6::Network bcrypt crypt32 advapi32 psapi shell32)

add_executable(Wv2QtTest WIN32 tests/qtmain.cpp src/WebViewHost.cpp src/WebViewHost.h)
target_include_directories(Wv2QtTest PRIVATE src third_party/webview2)
target_link_libraries(Wv2QtTest PRIVATE Qt6::Widgets ${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2/lib/x64/WebView2Loader.dll.lib)
add_custom_command(TARGET Wv2QtTest POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/third_party/webview2/lib/x64/WebView2Loader.dll"
        $<TARGET_FILE_DIR:Wv2QtTest>/WebView2Loader.dll
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/src/html/app.html"
        $<TARGET_FILE_DIR:Wv2QtTest>/app.html)



