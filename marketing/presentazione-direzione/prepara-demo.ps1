<#
.SYNOPSIS
  Prepara l'ambiente della demo alla direzione: stack collaudo, negozio demo,
  organizzazione "Northwind Commerce" con test, piani, schedulazione e storico di due settimane.

.DESCRIPTION
  Va lanciato dalla radice del repository, con Docker Desktop avviato, il giorno prima della demo.
  Ripetibile: ogni passo salta ciò che esiste già. Il passo dei dati (run reali) dura 15-20 minuti.

  -SoloVerifica  controlla soltanto che l'ambiente sia pronto, senza modificare nulla.
  -SenzaDati     avvia lo stack e il negozio, ma non crea organizzazione e run.

.EXAMPLE
  pwsh marketing/presentazione-direzione/prepara-demo.ps1
  pwsh marketing/presentazione-direzione/prepara-demo.ps1 -SoloVerifica
#>
param(
  [switch]$SoloVerifica,
  [switch]$SenzaDati
)

$ErrorActionPreference = 'Stop'
$root = git rev-parse --show-toplevel
Set-Location $root

$compose = @('-p', 'wfm-collaudo', '--env-file', 'collaudo/collaudo.env',
  '-f', 'docker-compose.yml', '-f', 'collaudo/docker-compose.collaudo.yml')
$demoCompose = $compose + @('-f', 'marketing/promo-video/docker-compose.demo.yml')
$env:NODE_EXTRA_CA_CERTS = Join-Path $root 'collaudo/collaudo-root.crt'
$url = 'https://wfm.collaudo.test'

function Passo($testo) { Write-Host "`n==> $testo" -ForegroundColor Cyan }
function Ok($testo) { Write-Host "    OK  $testo" -ForegroundColor Green }
function Ko($testo) { Write-Host "    KO  $testo" -ForegroundColor Red; $script:errori++ }
$script:errori = 0

function Verifica {
  Passo 'Verifica'
  try { docker info --format '{{.ServerVersion}}' | Out-Null; Ok 'Docker in esecuzione' }
  catch { Ko 'Docker non risponde: avviare Docker Desktop'; return }

  try {
    $r = Invoke-WebRequest "$url/readyz" -SkipCertificateCheck -TimeoutSec 10
    if ($r.StatusCode -eq 200) { Ok "$url/readyz risponde 200" } else { Ko "readyz: $($r.StatusCode)" }
  } catch { Ko "$url non raggiungibile (hosts o stack spento): $($_.Exception.Message)" }

  try {
    $r = Invoke-WebRequest "$url/demo-shop/" -SkipCertificateCheck -TimeoutSec 10
    if ($r.StatusCode -eq 200) { Ok 'negozio demo /demo-shop/ raggiungibile' }
  } catch { Ko 'negozio demo non raggiungibile' }

  try {
    $r = Invoke-WebRequest 'http://127.0.0.1:6080/' -TimeoutSec 5
    Ok 'schermo virtuale noVNC su http://127.0.0.1:6080 (serve alla registrazione)'
  } catch { Ko 'noVNC su 127.0.0.1:6080 non risponde: la registrazione live non si vedrà (usare il piano B)' }

  # Login come maya e conteggio di piani e run
  try {
    $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $body = @{ username = 'maya'; password = 'Demo.Video.2026!' } | ConvertTo-Json
    Invoke-RestMethod "$url/api/login" -Method Post -Body $body -ContentType 'application/json' `
      -WebSession $s -SkipCertificateCheck | Out-Null
    $plans = Invoke-RestMethod "$url/api/test-plans" -WebSession $s -SkipCertificateCheck
    $nomi = @($plans | ForEach-Object { $_.name })
    foreach ($p in 'Nightly regression', 'Checkout smoke', 'Orders API contract', 'Catalog checks') {
      if ($nomi -contains $p) { Ok "piano «$p»" } else { Ko "manca il piano «$p»" }
    }
  } catch { Ko "login di maya o lettura piani fallita: $($_.Exception.Message)" }

  if ($script:errori -eq 0) { Write-Host "`nPRONTO per la demo." -ForegroundColor Green }
  else { Write-Host "`n$($script:errori) problemi da risolvere (vedi sopra)." -ForegroundColor Yellow }
}

if ($SoloVerifica) { Verifica; exit $script:errori }

Passo 'Stack collaudo (build dell''immagine con il codice attuale)'
npm run collaudo:up
if ($LASTEXITCODE) { throw 'collaudo:up fallito' }
npm run collaudo:prepare
if ($LASTEXITCODE) { throw 'collaudo:prepare fallito' }

Passo 'Negozio demo contro cui girano i test'
docker compose @demoCompose up -d shop
if ($LASTEXITCODE) { throw 'avvio del negozio demo fallito' }

if (-not $SenzaDati) {
  Passo 'Organizzazione "Northwind Commerce" (owner maya)'
  Get-Content -Raw marketing/promo-video/demo/seed-org.mjs |
    docker compose @compose exec -T api node --input-type=module
  if ($LASTEXITCODE) { throw 'seed-org fallito' }

  Passo 'Test, piani, schedulazione e run reali (15-20 minuti)'
  node marketing/promo-video/demo/build-data.mjs
  if ($LASTEXITCODE) { throw 'build-data fallito' }

  Passo 'Storico distribuito sulle ultime due settimane (trend della dashboard)'
  Get-Content -Raw marketing/promo-video/demo/spread-history.mjs |
    docker compose @compose exec -T api node --input-type=module
  if ($LASTEXITCODE) { throw 'spread-history fallito' }
}

Verifica
exit $script:errori
