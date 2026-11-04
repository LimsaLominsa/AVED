@echo off
cd /d "%~dp0"
echo 正在启动万业携生收容公司网站预览...
echo 服务器运行期间请保持此窗口打开。关闭窗口即可停止预览。
start "万业携生网站服务" cmd /k "cd /d ""%~dp0"" && node server.mjs"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4173"
