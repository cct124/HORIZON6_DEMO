@echo off
chcp 65001 >nul
title HORIZON 6 - 地平线6
echo ============================================
echo   地平线 6  ^|  HORIZON 6
echo   正在启动本地服务器 http://localhost:8777
echo ============================================
cd /d "%~dp0"
start "" http://localhost:8777/index.html
python -m http.server 8777
