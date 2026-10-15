# Baixa o Node.js portátil (oficial, nodejs.org) para dentro da pasta da skill: <skill>\runtime\node
# Usado pelo "Abrir CaptaMais.bat" quando o computador não tem Node.js 18+ — assim a pessoa não precisa instalar nada.
# Nada é instalado no sistema nem alterado no PATH global: o Node fica só nesta pasta.
param([Parameter(Mandatory = $true)][string]$Dest)
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
$ProgressPreference = 'SilentlyContinue'

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$base = 'https://nodejs.org/dist/latest-v22.x/'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('captamais-node-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri ($base + 'SHASUMS256.txt')).Content
  $m = [regex]::Match([string]$sums, "(?m)^([a-f0-9]{64})\s+(node-v[\d\.]+-win-$arch\.zip)\s*$")
  if (-not $m.Success) { throw 'Não encontrei o pacote do Node.js para este computador.' }
  $expected = $m.Groups[1].Value
  $name = $m.Groups[2].Value

  $zip = Join-Path $tmp $name
  Invoke-WebRequest -UseBasicParsing -Uri ($base + $name) -OutFile $zip

  # Confere a integridade: só usa o arquivo se o SHA-256 bater com o publicado pelo nodejs.org.
  $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
  if ($actual -ne $expected) { throw 'O arquivo baixado não confere com o checksum oficial. Tente de novo.' }

  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $inner = Join-Path $tmp ($name -replace '\.zip$', '')
  if (-not (Test-Path (Join-Path $inner 'node.exe'))) { throw 'Pacote do Node.js inesperado.' }

  $parent = Split-Path -Parent $Dest
  if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
  if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
  Move-Item -Path $inner -Destination $Dest
  exit 0
} catch {
  Write-Host (' ' + $_.Exception.Message)
  exit 1
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
