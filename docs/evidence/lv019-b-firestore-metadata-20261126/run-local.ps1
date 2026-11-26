param(
  [Parameter(Mandatory)][string]$Node,
  [Parameter(Mandatory)][string]$Java,
  [Parameter(Mandatory)][string]$Jar,
  [Parameter(Mandatory)][string]$Dependencies
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows runner only' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$metadataNode = (Resolve-Path -LiteralPath $Node).Path
$metadataJava = (Resolve-Path -LiteralPath $Java).Path
$metadataJar = (Resolve-Path -LiteralPath $Jar).Path
$dependencies = (Resolve-Path -LiteralPath $Dependencies).Path
$metadataProject = 'demo-vistavo-metadata'
$metadataAddress = '127.0.0.1'
$metadataPort = 8194
$websocketPort = 9194
$guardSource = Join-Path $repo 'scripts/reviewEmulatorNetworkGuard.cjs'
$fixture = Join-Path $PSScriptRoot 'metadata.emulator.mjs'
$guardText = [IO.File]::ReadAllText($guardSource)
if (!$guardText.Contains('127.0.0.1:8185') -or !$guardText.Contains('demo-vistavo-ledger')) {
  throw 'Unexpected source guard'
}
if (!(Test-Path -LiteralPath (Join-Path $dependencies 'node_modules/firebase-admin/package.json') -PathType Leaf)) {
  throw 'Pass a repository directory with pre-installed Firebase Admin dependencies'
}

function ListenerInventory($Ports) {
  # Reads the operating system's listening sockets; it does not contact a port.
  @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
    Where-Object { $_.LocalPort -in $Ports } |
    Sort-Object LocalPort,LocalAddress,OwningProcess |
    Select-Object LocalAddress,LocalPort,OwningProcess)
}

$observedPorts = @(8185,8186,8187,$metadataPort,$websocketPort)
$before = @(ListenerInventory $observedPorts)
if ($before.LocalPort -contains $metadataPort -or $before.LocalPort -contains $websocketPort) {
  throw 'A dedicated metadata port is already in use'
}

$outputRoot = Join-Path $repo 'outputs/lv019-b-firestore-metadata-20261126'
$run = Join-Path $outputRoot ('run-' + [guid]::NewGuid())
$profile = Join-Path $run 'profile'
$temp = Join-Path $run 'temp'
New-Item -ItemType Directory -Path $profile,$temp -Force | Out-Null
$guard = Join-Path $run 'network-guard.cjs'
[IO.File]::WriteAllText($guard,$guardText.Replace('8185','8194').Replace('demo-vistavo-ledger',$metadataProject))
$rec = [ordered]@{
  project = $metadataProject
  host = $metadataAddress
  port = $metadataPort
  websocketPort = $websocketPort
  stage = 'prepared'
  startedAt = [DateTimeOffset]::UtcNow.ToString('o')
  listenersBefore = @($before)
  environmentKeys = @()
  ownedJavaPid = $null
  ownedJavaListeners = @()
  ownedNodePid = $null
  nodeExit = $null
  ownedJavaExited = $false
  listenersAfter = @()
  inputs = [ordered]@{}
}
foreach ($entry in @{guardSource=$guardSource;guard=$guard;fixture=$fixture;jar=$metadataJar;runner=$PSCommandPath}.GetEnumerator()) {
  $rec.inputs[$entry.Key] = (Get-FileHash -Algorithm SHA256 -LiteralPath $entry.Value).Hash.ToLower()
}
function SaveReceipt($Stage) {
  $rec.stage = $Stage
  $rec | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $run 'run.json') -Encoding utf8
}
SaveReceipt 'prepared'
Write-Output "Evidence: $run"

function LaunchHidden($Executable, [string[]]$Arguments, $Label, $IsFixture = $false) {
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Executable
  $start.WorkingDirectory = $run
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.Environment.Clear()
  foreach ($item in @{
    SystemRoot=$env:SystemRoot; USERPROFILE=$profile; LOCALAPPDATA=$profile; APPDATA=$profile
    TEMP=$temp; TMP=$temp; NODE_ENV='test'; LV_REVIEW_CONTRACT='1'; METADATA_SERVER_DETECTION='none'
    GOOGLE_CLOUD_PROJECT=$metadataProject; FIRESTORE_EMULATOR_HOST="$($metadataAddress):$metadataPort"
  }.GetEnumerator()) { $start.Environment[$item.Key] = $item.Value }
  if ($IsFixture) { $start.Environment['LV_METADATA_DEPENDENCIES'] = $dependencies }
  foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
  $rec.environmentKeys += @{process=$Label; keys=@($start.Environment.Keys | Sort-Object)}
  $process = [Diagnostics.Process]::Start($start)
  [pscustomobject]@{Process=$process; Label=$Label;
    Stdout=$process.StandardOutput.ReadToEndAsync(); Stderr=$process.StandardError.ReadToEndAsync()}
}

$javaRun = $null
$nodeRun = $null
try {
  $javaRun = LaunchHidden $metadataJava @("-Duser.home=$profile","-Djava.io.tmpdir=$temp",
    '-jar',$metadataJar,'--host',$metadataAddress,'--port',"$metadataPort",'--project_id',$metadataProject,
    '--websocket_port',"$websocketPort",'--single_project_mode','true','--single_project_mode_error','true') 'emulator'
  $rec.ownedJavaPid = $javaRun.Process.Id
  SaveReceipt 'java-started'
  Write-Output "Owned Java PID $($rec.ownedJavaPid)"
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds(20)
  do {
    if ($javaRun.Process.HasExited) { throw 'Owned emulator exited during startup' }
    $owned = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
      Where-Object { $_.OwningProcess -eq $javaRun.Process.Id } |
      Select-Object LocalAddress,LocalPort,OwningProcess)
    if ($owned.Count -ge 2) { break }
    Start-Sleep -Milliseconds 100
  } while ([DateTimeOffset]::UtcNow -lt $deadline)
  $rec.ownedJavaListeners = $owned
  if ($owned.Count -ne 2 -or @($owned | Where-Object LocalAddress -ne $metadataAddress).Count -ne 0 -or
      $owned.LocalPort -notcontains $metadataPort -or $owned.LocalPort -notcontains $websocketPort) {
    throw 'Owned Java must directly listen on exactly the two dedicated IPv4 ports'
  }
  SaveReceipt 'listeners-verified'

  $nodeRun = LaunchHidden $metadataNode @('--require',$guard,'--test','--test-concurrency=1',
    '--test-isolation=none','--test-timeout=12000','--test-reporter=tap',$fixture) 'fixture' $true
  $rec.ownedNodePid = $nodeRun.Process.Id
  SaveReceipt 'node-started'
  Write-Output "Owned Node PID $($rec.ownedNodePid)"
  if (!$nodeRun.Process.WaitForExit(45000)) { throw 'Metadata fixture timed out' }
  $rec.nodeExit = $nodeRun.Process.ExitCode
  if ($rec.nodeExit -ne 0 -or $nodeRun.Stderr.Result -match 'VISTAVO_REVIEW_NETWORK_DENIED' -or
      $nodeRun.Stdout.Result -match 'VISTAVO_REVIEW_NETWORK_DENIED') {
    throw 'Metadata fixture did not pass under the guard'
  }
  if ($nodeRun.Stderr.Result -notmatch 'VISTAVO_REVIEW_NETWORK_GUARD_ACTIVE SELF_CHECK=PASS') {
    throw 'No successful guard self-check in fixture output'
  }
} finally {
  # Process objects refer only to children created by this runner. Never stop by a port or name.
  foreach ($entry in @($nodeRun,$javaRun)) {
    if ($null -eq $entry) { continue }
    if (!$entry.Process.HasExited) { $entry.Process.Kill() }
    if (!$entry.Process.WaitForExit(10000)) { throw "Owned child did not exit: $($entry.Label)" }
    [IO.File]::WriteAllText((Join-Path $run ($entry.Label+'.stdout.log')),$entry.Stdout.Result)
    [IO.File]::WriteAllText((Join-Path $run ($entry.Label+'.stderr.log')),$entry.Stderr.Result)
  }
  $rec.ownedJavaExited = $null -ne $javaRun -and $javaRun.Process.HasExited
  $rec.listenersAfter = @(ListenerInventory $observedPorts)
  $rec.endedAt = [DateTimeOffset]::UtcNow.ToString('o')
  SaveReceipt 'processes-exited'
}
if (!$rec.ownedJavaExited -or $rec.listenersAfter.LocalPort -contains $metadataPort -or
    $rec.listenersAfter.LocalPort -contains $websocketPort) {
  throw 'Exclusive emulator did not cleanly stop'
}
