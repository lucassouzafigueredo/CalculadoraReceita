# Inicia o Simulador da Reforma Tributaria (Windows).
# 1) verifica se ha versao nova (calculadora oficial atualizada) e atualiza a pasta app
# 2) sobe a calculadora oficial com o Java embutido
# 3) abre o simulador no navegador
# Obs.: arquivo propositalmente sem acentos (compatibilidade com Windows PowerShell 5.1).

$ErrorActionPreference = 'Stop'
$Raiz = Split-Path -Parent $PSScriptRoot
$App = Join-Path $Raiz 'app'
$Logs = Join-Path $Raiz 'logs'
$ArqPid = Join-Path $Raiz 'simulador.pid'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

function Escrever($msg) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) }

$cfg = Get-Content (Join-Path $Raiz 'config.json') -Raw | ConvertFrom-Json
$Porta = [int]$cfg.porta
$UrlVersao = "http://localhost:$Porta/api/calculadora/dados-abertos/versao"
$UrlTela = "http://localhost:$Porta/api/simulador.html"

function Ler-VersaoLocal {
  $f = Join-Path $App 'web\versao.json'
  if (Test-Path $f) { return (Get-Content $f -Raw | ConvertFrom-Json) }
  return $null
}

function Calculadora-NoAr {
  try { Invoke-RestMethod -Uri $UrlVersao -TimeoutSec 3 | Out-Null; return $true } catch { return $false }
}

function Parar-Calculadora {
  if (Test-Path $ArqPid) {
    $id = Get-Content $ArqPid
    try { Stop-Process -Id $id -Force -ErrorAction Stop; Escrever 'Calculadora anterior encerrada.' } catch {}
    Remove-Item $ArqPid -Force -ErrorAction SilentlyContinue
  }
  Get-CimInstance Win32_Process -Filter "Name like 'java%'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*api-regime-geral.jar*' -and $_.CommandLine -like "*server.port=$Porta*" } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
  Start-Sleep -Seconds 1
}

# ---------- 1) atualizacao ----------
$local = Ler-VersaoLocal
if ($local) { Escrever ("Versao instalada: {0} (calculadora oficial {1}, tabelas {2})" -f $local.pacote, $local.versao_calculadora, $local.versao_tabelas) }

if ($cfg.verificar_atualizacao) {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Escrever 'Verificando atualizacoes...'
    $rel = Invoke-RestMethod -Uri $cfg.url_atualizacao -TimeoutSec 15 -Headers @{ 'User-Agent' = 'simulador-rtc' }
    $nova = $rel.tag_name
    if ($nova -and (-not $local -or $nova -ne $local.pacote)) {
      $asset = $rel.assets | Where-Object { $_.name -eq $cfg.arquivo_atualizacao } | Select-Object -First 1
      if ($asset) {
        Escrever "Nova versao disponivel: $nova. Baixando..."
        $tmp = Join-Path $env:TEMP ("simulador-rtc-" + [guid]::NewGuid())
        New-Item -ItemType Directory -Force -Path $tmp | Out-Null
        $zip = Join-Path $tmp 'atualizacao.zip'
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing -Headers @{ 'User-Agent' = 'simulador-rtc' }
        Expand-Archive -Path $zip -DestinationPath (Join-Path $tmp 'x') -Force
        Parar-Calculadora
        $bak = "$App.anterior"
        if (Test-Path $bak) { Remove-Item $bak -Recurse -Force }
        if (Test-Path $App) { Rename-Item $App $bak }
        Move-Item (Join-Path $tmp 'x\app') $App
        if (Test-Path (Join-Path $tmp 'x\scripts')) { Copy-Item (Join-Path $tmp 'x\scripts\*') $PSScriptRoot -Recurse -Force }
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path $bak) { Remove-Item $bak -Recurse -Force -ErrorAction SilentlyContinue }
        $local = Ler-VersaoLocal
        Escrever ("Atualizado para {0} (calculadora oficial {1})." -f $local.pacote, $local.versao_calculadora)
      }
    } else {
      Escrever 'Voce ja esta na versao mais recente.'
    }
  } catch {
    Escrever ("Nao foi possivel verificar atualizacoes ({0}). Seguindo com a versao instalada." -f $_.Exception.Message)
    # se a troca da pasta falhou no meio, restaura a versao anterior
    if (-not (Test-Path $App) -and (Test-Path "$App.anterior")) { Rename-Item "$App.anterior" $App }
  }
}

# ---------- 2) calculadora ----------
$IniciouCalculadora = $false
if (Calculadora-NoAr) {
  Escrever 'Calculadora ja esta em execucao.'
} else {
  $IniciouCalculadora = $true
  $java = Join-Path $Raiz 'jre\bin\java.exe'
  if (-not (Test-Path $java)) {
    $cmd = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($cmd) { $java = $cmd.Source } else { throw 'Java nao encontrado. Baixe novamente o pacote completo (Simulador-RTC-Windows.zip).' }
  }
  Escrever 'Iniciando a calculadora oficial (leva de 10 a 40 segundos)...'
  $argsJava = @('-Xmx1g', '-Dspring.profiles.active=offline', '-jar', 'api-regime-geral.jar',
            "--server.port=$Porta", '--spring.web.resources.static-locations=file:./web/', '--management.server.port=-1')
  $p = Start-Process -FilePath $java -ArgumentList $argsJava -WorkingDirectory $App -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $Logs 'calculadora.log') -RedirectStandardError (Join-Path $Logs 'calculadora-erros.log')
  Set-Content -Path $ArqPid -Value $p.Id
  $ok = $false
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    if ($p.HasExited) { break }
    if (Calculadora-NoAr) { $ok = $true; break }
  }
  if (-not $ok) {
    Escrever 'A calculadora nao respondeu. Veja a pasta logs. Porta em uso? Altere "porta" no config.json.'
    if (-not $env:CI) { Read-Host 'Pressione Enter para sair' }
    exit 1
  }
}

# ---------- 3) navegador ----------
# Abre o simulador numa janela propria (Edge ou Chrome com perfil separado) e,
# quando essa janela for fechada, desliga a calculadora automaticamente.
function Achar-Navegador {
  $candidatos = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
  )
  foreach ($c in $candidatos) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

function Processos-DoPerfil($perfil) {
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe' or Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($perfil) }
}

function Janela-Aberta($perfil) {
  foreach ($proc in (Processos-DoPerfil $perfil)) {
    $gp = Get-Process -Id $proc.ProcessId -ErrorAction SilentlyContinue
    if ($gp -and $gp.MainWindowHandle -ne [IntPtr]::Zero) { return $true }
  }
  return $false
}

function Minimizar-Console {
  try {
    Add-Type -Namespace Sim -Name Win -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);
'@ -ErrorAction Stop
    [Sim.Win]::ShowWindow([Sim.Win]::GetConsoleWindow(), 6) | Out-Null
  } catch {}
}

if ($env:SIMULADOR_SEM_NAVEGADOR) {
  Escrever "Simulador no ar em $UrlTela"
  exit 0
}

$navegador = $null
if ($cfg.fechar_com_navegador -ne $false) { $navegador = Achar-Navegador }

if (-not $navegador) {
  Escrever "Abrindo $UrlTela"
  try { Start-Process $UrlTela } catch { Escrever "Abra no navegador: $UrlTela" }
  Escrever 'Pronto. Pode fechar esta janela; para desligar use "Encerrar Simulador".'
  Start-Sleep -Seconds 4
  exit 0
}

$Perfil = Join-Path $Raiz 'perfil-navegador'
New-Item -ItemType Directory -Force -Path $Perfil | Out-Null
$argsNav = @("--app=$UrlTela", "--user-data-dir=`"$Perfil`"", '--no-first-run', '--no-default-browser-check',
             '--disable-background-mode', '--disable-features=msEdgeStartupBoost', '--window-size=1366,900')
Escrever "Abrindo o simulador ($([IO.Path]::GetFileNameWithoutExtension($navegador)))..."
$nav = Start-Process -FilePath $navegador -ArgumentList $argsNav -PassThru

if (-not $IniciouCalculadora) {
  # outra janela do simulador ja controla a calculadora; esta so abre a tela
  Start-Sleep -Seconds 3
  exit 0
}

Escrever 'Simulador aberto. Ao fechar a janela do simulador, a calculadora e desligada automaticamente.'
Minimizar-Console

# espera a janela aparecer (ate 40 s) e depois acompanha ate ela ser fechada
$apareceu = $false
for ($i = 0; $i -lt 40 -and -not $apareceu; $i++) {
  Start-Sleep -Seconds 1
  $apareceu = Janela-Aberta $Perfil
}
$semJanela = 0
while ($true) {
  Start-Sleep -Seconds 2
  if ($apareceu) {
    if (Janela-Aberta $Perfil) { $semJanela = 0 } else { $semJanela++ }
    if ($semJanela -ge 2) { break }
  } else {
    # nao foi possivel detectar a janela: usa o fim dos processos do navegador
    if (-not (Processos-DoPerfil $Perfil)) { break }
  }
}

Escrever 'Janela do simulador fechada. Desligando a calculadora...'
Processos-DoPerfil $Perfil | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force } catch {} }
Parar-Calculadora
Escrever 'Simulador encerrado.'
