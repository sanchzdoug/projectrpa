@echo off
rem Sobe o painel de controle do SE Mapper e abre no navegador padrao.
rem Feche esta janela (ou Ctrl+C) para encerrar a aplicacao.

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Node.js nao encontrado no PATH.
  echo   Instale em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

echo.
echo   SE Mapper — subindo o painel de controle...
echo   Endereco: http://localhost:7300
echo   Mantenha esta janela aberta enquanto usar a aplicacao.
echo.

start "" http://localhost:7300
node se.js painel

echo.
echo   Painel encerrado.
pause
