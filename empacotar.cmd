@echo off
REM Empacota o SE-Mapper para levar a outra maquina.
REM
REM O pacote leva CODIGO e nada mais: dados/ fica de fora porque contem
REM configuracao GxP de cliente, prints de tela e nomes de usuarios.
setlocal
set RAIZ=%~dp0
set SAIDA=%RAIZ%se-mapper-pacote.zip

if exist "%SAIDA%" del "%SAIDA%"

powershell -NoProfile -Command ^
  "$itens = @('se.js','package.json','iniciar.cmd','empacotar.cmd','README.md','lib','ferramentas');" ^
  "$itens = $itens | Where-Object { Test-Path (Join-Path '%RAIZ%' $_) } | ForEach-Object { Join-Path '%RAIZ%' $_ };" ^
  "Compress-Archive -Path $itens -DestinationPath '%SAIDA%' -Force;" ^
  "$mb = [math]::Round((Get-Item '%SAIDA%').Length / 1MB, 2);" ^
  "Write-Host ''; Write-Host ('Pacote gerado: %SAIDA%  (' + $mb + ' MB)');" ^
  "Write-Host 'Conteudo: codigo da ferramenta. A pasta dados/ NAO foi incluida.'"

echo.
echo Na maquina de destino:
echo    1. descompacte o zip
echo    2. npm install
echo    3. node ferramentas\verificar-ambiente.js
echo    4. node se.js painel      (ou node se.js env --url ...)
echo.
endlocal
