@echo off
title Geoportal Urbanistico - Iniciar Servidor (Universal)
cd /d "%~dp0"

echo ===========================================================
echo   INICIANDO GEOPORTAL URBANISTICO - SELAGEM HABITACIONAL
echo ===========================================================
echo.
echo Verificando ambiente de execucao...

:: 1. Testa se o comando 'python' padrão existe no computador
python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Python detectado no sistema! Iniciando servidor Python...
    python server.py
    goto END
)

:: 2. Testa se o Python do QGIS existe no computador
if exist "C:\Program Files\QGIS 3.42.0\apps\Python312\python.exe" (
    echo [OK] Python do QGIS detectado! Iniciando servidor...
    "C:\Program Files\QGIS 3.42.0\apps\Python312\python.exe" server.py
    goto END
)

:: 3. Se NAO houver Python instalado, usa o Servidor Nativo do Windows em PowerShell (Funciona em QUALQUER PC Windows)
echo [INFO] Python nao encontrado neste computador.
echo [INFO] Iniciando Servidor HTTP Nativo do Windows (PowerShell)...
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0server.ps1"

:END
pause
