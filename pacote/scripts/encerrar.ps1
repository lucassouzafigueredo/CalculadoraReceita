# Encerra a calculadora usada pelo simulador. (sem acentos de proposito)
$Raiz = Split-Path -Parent $PSScriptRoot
$ArqPid = Join-Path $Raiz 'simulador.pid'
$cfg = Get-Content (Join-Path $Raiz 'config.json') -Raw | ConvertFrom-Json
$Porta = [int]$cfg.porta
$parou = $false
if (Test-Path $ArqPid) {
  try { Stop-Process -Id (Get-Content $ArqPid) -Force -ErrorAction Stop; $parou = $true } catch {}
  Remove-Item $ArqPid -Force -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "Name like 'java%'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*api-regime-geral.jar*' -and $_.CommandLine -like "*server.port=$Porta*" } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force; $parou = $true } catch {} }
# fecha tambem a janela do simulador, se estiver aberta
$Perfil = Join-Path $Raiz 'perfil-navegador'
Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Perfil) } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
if ($parou) { Write-Host 'Simulador encerrado.' } else { Write-Host 'O simulador nao estava em execucao.' }
Start-Sleep -Seconds 2
