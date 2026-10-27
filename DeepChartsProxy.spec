# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_submodules
from PyInstaller.utils.hooks import collect_all

datas = [('C:\\TradingPlatform\\client\\build\\Release\\DeepCharts-Portable-Fixed-main\\proxy\\mitm\\config.py', '.'), ('C:\\TradingPlatform\\client\\build\\Release\\DeepCharts-Portable-Fixed-main\\proxy\\mitm\\requirements.txt', '.')]
binaries = []
hiddenimports = ['WebAPI', 'WebAPI.webapi_2_pb2', 'WebAPI.user_session_2_pb2', 'WebAPI.historical_2_pb2', 'WebAPI.market_data_2_pb2', 'common', 'common.shared_1_pb2', 'common.decimal_pb2', 'queue', 'google', 'google.protobuf']
hiddenimports += collect_submodules('WebAPI')
hiddenimports += collect_submodules('common')
tmp_ret = collect_all('google')
datas += tmp_ret[0]; binaries += tmp_ret[1]; hiddenimports += tmp_ret[2]


a = Analysis(
    ['C:\\TradingPlatform\\client\\build\\Release\\DeepCharts-Portable-Fixed-main\\proxy\\mitm\\bridge_mitm_proxy.py'],
    pathex=['C:\\TradingPlatform\\client\\build\\Release\\DeepCharts-Portable-Fixed-main\\proxy\\mitm', 'C:\\TradingPlatform\\client\\build\\Release\\DeepCharts-Portable-Fixed-main\\proxy\\cqg'],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='DeepChartsProxy',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='DeepChartsProxy',
)
