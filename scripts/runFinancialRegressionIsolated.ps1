param(
  [Parameter(Mandatory)][string]$Node,
  [Parameter(Mandatory)][string]$Jdk,
  [Parameter(Mandatory)][string]$Jar,
  [Parameter(Mandatory)][string]$Dependencies,
  [Parameter(Mandatory)][string]$Manifest,
  [Parameter(Mandatory)][string]$ExpectedManifestSha256,
  [Parameter(Mandatory)][string]$SystemManifest,
  [Parameter(Mandatory)][string]$ExpectedSystemManifestSha256,
  [switch]$VerifyOnly
)
$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'Windows runner only' }

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodePath = (Resolve-Path -LiteralPath $Node).Path
$jdkPath = (Resolve-Path -LiteralPath $Jdk).Path
$jarPath = (Resolve-Path -LiteralPath $Jar).Path
$dependenciesPath = (Resolve-Path -LiteralPath $Dependencies).Path
$manifestPath = (Resolve-Path -LiteralPath $Manifest).Path
$systemManifestPath = (Resolve-Path -LiteralPath $SystemManifest).Path
$javaPath = Join-Path $jdkPath 'bin/java.exe'
$javacPath = Join-Path $jdkPath 'bin/javac.exe'
foreach ($file in $javaPath,$javacPath,(Join-Path $jdkPath 'lib/modules')) {
  if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'Supply a complete JDK, without a PATH launcher' }
}
$expectedJar = 'c3d3680a89d946a90a027365ea14c26c6472a162bcf37f099bbb1ebd66d25e8e'
function Sha256($File) { (Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash.ToLowerInvariant() }
if ((Sha256 $jarPath) -ne $expectedJar) { throw 'Emulator JAR differs from the locally inspected 1.21.0 input' }
if ($ExpectedManifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Sha256 $manifestPath) -cne $ExpectedManifestSha256) {
  throw 'Manifest SHA-256 differs from the reviewed value'
}
if ($dependenciesPath -ine $repo) { throw 'Dependencies must belong to this worktree' }
if ($ExpectedSystemManifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Sha256 $systemManifestPath) -cne $ExpectedSystemManifestSha256) {
  throw 'System manifest SHA-256 differs from the reviewed value'
}
$system = Get-Content -Raw -LiteralPath $systemManifestPath | ConvertFrom-Json
$jdkInputs = [ordered]@{java=$javaPath;javac=$javacPath;javaDll=(Join-Path $jdkPath 'bin/java.dll');
  jvm=(Join-Path $jdkPath 'bin/server/jvm.dll');modules=(Join-Path $jdkPath 'lib/modules')}
function AssertFrozenSystem {
  if ((Sha256 $systemManifestPath) -cne $ExpectedSystemManifestSha256 -or
      (Sha256 $manifestPath) -cne $ExpectedManifestSha256 -or
      $system.version -ne 1 -or $system.base -cne '0244bfc591368524a4b980312c20c9b53952a532' -or
      $system.project -cne 'demo-vistavo-financial' -or $system.host -cne '127.0.0.1:8198' -or
      (($system.fixedPorts -join ',') -cne '8198,9198,9298') -or
      $system.candidate.path -ine $manifestPath -or $system.candidate.sha256 -cne $ExpectedManifestSha256 -or
      $system.node.path -ine $nodePath -or $system.node.sha256 -cne (Sha256 $nodePath) -or
      $system.jdk.path -ine $jdkPath -or $system.jar.path -ine $jarPath -or $system.jar.sha256 -cne (Sha256 $jarPath)) {
    throw 'Frozen system identity differs from reviewed inputs'
  }
  foreach ($name in $jdkInputs.Keys) {
    $file = (Resolve-Path -LiteralPath $jdkInputs[$name]).Path
    $expected = $system.jdk.files.$name
    if ($expected.path -ine $file -or $expected.sha256 -cne (Sha256 $file)) { throw "Frozen JDK input differs: $name" }
  }
}
AssertFrozenSystem
if ($VerifyOnly) {
  Write-Output 'Frozen executable and manifest identities: PASS; no emulator was started'
  return
}

$project = 'demo-vistavo-financial'
$address = '127.0.0.1'
$fixedPorts = @(8198,9198,9298)
$sharedPorts = @(8185,8186,8187,8194,9194,9294,8195,9195,9295,8197,9197,9297)
$fixture = Join-Path $PSScriptRoot 'runFinancialRegressionEmulator.mjs'
$javaSource = Join-Path $PSScriptRoot 'InspectFinancialRegressionFirestore.java'
$guardSource = Join-Path $repo 'scripts/financialEmulatorNetworkGuard.cjs'
$guardText = [IO.File]::ReadAllText($guardSource)
if (!$guardText.Contains('127.0.0.1:8198') -or !$guardText.Contains($project)) {
  throw 'Unexpected source guard'
}
$adminPackage = Join-Path $dependenciesPath 'node_modules/firebase-admin/package.json'
$firestorePackage = Join-Path $dependenciesPath 'node_modules/@google-cloud/firestore/package.json'
$adminVersion = (Get-Content -Raw -LiteralPath $adminPackage | ConvertFrom-Json).version
$firestoreVersion = (Get-Content -Raw -LiteralPath $firestorePackage | ConvertFrom-Json).version
function Listeners {
  # OS inventory only. This query does not connect to the sockets.
  @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Sort-Object LocalPort,LocalAddress,OwningProcess |
    Select-Object LocalAddress,LocalPort,OwningProcess)
}
$before = @(Listeners)
if (@($before | Where-Object LocalPort -in $fixedPorts).Count) { throw 'A dedicated port is already in use' }

$nonce = [guid]::NewGuid().ToString()
$outputBase = (Resolve-Path -LiteralPath (Join-Path $repo 'outputs')).Path
if ($outputBase -ine (Join-Path $repo 'outputs') -or ((Get-Item -LiteralPath $outputBase -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'Output root is not a real directory inside this worktree'
}
$runBase = Join-Path $outputBase 'lv019-b-financial-isolation-20261126'
if (!(Test-Path -LiteralPath $runBase)) { New-Item -ItemType Directory -Path $runBase | Out-Null }
if (((Get-Item -LiteralPath $runBase -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    (Resolve-Path -LiteralPath $runBase).Path -ine $runBase) { throw 'Unsafe isolation evidence directory' }
$run = Join-Path $runBase "run-$nonce"
if (Test-Path -LiteralPath $run) { throw 'Run evidence directory already exists' }
New-Item -ItemType Directory -Path $run | Out-Null
$profile = Join-Path $run 'profile'
$temp = Join-Path $run 'temp'
$classes = Join-Path $run 'classes'
$ready = Join-Path $run 'ready.txt'
$stop = Join-Path $run 'stop.txt'
$guard = Join-Path $run 'network-guard.cjs'
New-Item -ItemType Directory -Path $profile,$temp,$classes | Out-Null
[IO.File]::WriteAllText($guard,$guardText)
$record = [ordered]@{
  startedAt = [DateTimeOffset]::UtcNow.ToString('o')
  project = $project; address = $address; nonce = $nonce
  fixedPorts = $fixedPorts; clientPort = 8198; grpcBackendPort = $null
  listenersBefore = @($before | Where-Object LocalPort -in ($fixedPorts + $sharedPorts))
  listenerProofs = @(); environmentKeys = @(); stage = 'prepared'
  ownedJavaPid = $null; ownedNodePid = $null; nodeExit = $null
  javaStoppedByNonce = $false; processReceipts = @(); failure = $null
  fixtureVersion = @{firebaseAdmin=$adminVersion;firestore=$firestoreVersion}
  inputs = [ordered]@{
    jar = $expectedJar; fixture = (Sha256 $fixture); javaSource = (Sha256 $javaSource)
    guardSource = (Sha256 $guardSource); guard = (Sha256 $guard); launcher = (Sha256 $PSCommandPath); manifest = (Sha256 $manifestPath)
    systemManifest = (Sha256 $systemManifestPath); node = (Sha256 $nodePath); jdk = $system.jdk.files
  }
}
function SaveReceipt($Stage) {
  $record.stage = $Stage
  $record | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $run 'run.json') -Encoding utf8
}
SaveReceipt 'prepared'
Write-Output "Evidence: $run"

function Launch($Executable, [string[]]$Arguments, $Label) {
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
    GOOGLE_CLOUD_PROJECT=$project; GCLOUD_PROJECT=$project; LV_FINANCIAL_REGRESSION='1'; FIRESTORE_EMULATOR_HOST="$($address):8198"
  }.GetEnumerator()) { $start.Environment[$item.Key] = $item.Value }
  if ($Label -eq 'fixture') { $start.Environment['LV_METADATA_DEPENDENCIES'] = $dependenciesPath }
  foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
  $record.environmentKeys += @{process=$Label; keys=@($start.Environment.Keys | Sort-Object)}
  $process = [Diagnostics.Process]::Start($start)
  [pscustomobject]@{Process=$process; Label=$Label;
    Stdout=$process.StandardOutput.ReadToEndAsync(); Stderr=$process.StandardError.ReadToEndAsync()}
}

function CheckListeners($Label, [int[]]$Expected) {
  $now = @(Listeners)
  $owned = @($now | Where-Object OwningProcess -eq $record.ownedJavaPid)
  $tracked = @($now | Where-Object LocalPort -in $Expected)
  $record.listenerProofs += @{phase=$Label; owned=$owned; tracked=$tracked}
  SaveReceipt $Label
  if ($owned.Count -ne $Expected.Count -or $tracked.Count -ne $Expected.Count -or
      @($owned | Where-Object { $_.LocalAddress -ne $address -or $_.LocalPort -notin $Expected }).Count) {
    throw 'The exact role-bound listeners do not belong exclusively to our IPv4 loopback JVM'
  }
}

$compile = $null
$java = $null
$client = $null
$javaOpts = @("-Duser.home=$profile","-Djava.io.tmpdir=$temp")
$backendPort = $null
try {
  $compile = Launch $javacPath @("-J$($javaOpts[0])","-J$($javaOpts[1])",'-proc:none','-cp',$jarPath,
    '-d',$classes,$javaSource) 'compile'
  if (!$compile.Process.WaitForExit(15000) -or $compile.Process.ExitCode -ne 0) { throw 'Local launcher compilation failed' }

  $java = Launch $javaPath ($javaOpts + @('-cp',"$classes;$jarPath",'InspectFinancialRegressionFirestore',$ready,$stop,$nonce)) 'emulator'
  $record.ownedJavaPid = $java.Process.Id
  SaveReceipt 'java-started'
  Write-Output "Owned Java PID $($java.Process.Id)"
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds(15)
  while (!(Test-Path -LiteralPath $ready -PathType Leaf)) {
    if ($java.Process.HasExited -or [DateTimeOffset]::UtcNow -ge $deadline) { throw 'Owned JVM did not attest its backend socket' }
    Start-Sleep -Milliseconds 100
  }
  $reported = @(Get-Content -LiteralPath $ready)
  if ($reported.Count -ne 5 -or $reported[0] -cne $nonce -or $reported[1] -ne "$($java.Process.Id)" -or
      $reported[2] -cne $project -or $reported[3] -cne $address -or $reported[4] -notmatch '^[0-9]{1,5}$') {
    throw 'Unexpected JVM readiness record'
  }
  $backendPort = [int]$reported[4]
  $record.grpcBackendPort = $backendPort
  if ($backendPort -lt 1024 -or $backendPort -gt 65535 -or $backendPort -in ($fixedPorts + $sharedPorts) -or
      $before.LocalPort -contains $backendPort) { throw 'The private gRPC listener overlaps another port' }
  $expected = $fixedPorts + @($backendPort)
  CheckListeners 'before-fixture' $expected

  $client = Launch $nodePath @('--require',$guard,$fixture,'--run',$manifestPath) 'fixture'
  $record.ownedNodePid = $client.Process.Id
  SaveReceipt 'fixture-started'
  Write-Output "Owned Node PID $($client.Process.Id)"
  if (!$client.Process.WaitForExit(5400000)) { throw 'Synthetic financial fixture timed out' }
  $record.nodeExit = $client.Process.ExitCode
  CheckListeners 'after-fixture' $expected
  $output = $client.Stdout.Result + $client.Stderr.Result
  if ($record.nodeExit -ne 0 -or $output -match 'VISTAVO_REVIEW_NETWORK_DENIED' -or
      $output -notmatch 'VISTAVO_FINANCIAL_NETWORK_GUARD_ACTIVE SELF_CHECK=PASS' -or
      $output -notmatch 'Synthetic financial regression: PASS') { throw 'Fixture did not pass under its guard' }
  AssertFrozenSystem
} catch {
  $record.failure = $_.Exception.Message
  throw
} finally {
  $cleanupErrors = @()
  foreach ($entry in @($client,$java,$compile)) {
    if ($null -eq $entry) { continue }
    try {
      if (!$entry.Process.HasExited -and $entry.Label -eq 'emulator' -and (Test-Path -LiteralPath $ready -PathType Leaf)) {
        [IO.File]::WriteAllText($stop,$nonce)
        $record.javaStoppedByNonce = $entry.Process.WaitForExit(6500)
      }
      # Only the owned process handle and its live child tree are stopped.
      if (!$entry.Process.HasExited) {
        if ($entry.Label -eq 'fixture') { $entry.Process.Kill($true) }
        else { $entry.Process.Kill() }
      }
      if (!$entry.Process.WaitForExit(5000)) { throw "Owned process did not exit: $($entry.Label)" }
      $record.processReceipts += @{label=$entry.Label; id=$entry.Process.Id; exit=$entry.Process.ExitCode}
      if (!$entry.Stdout.Wait(5000) -or !$entry.Stderr.Wait(5000)) { throw "Owned process streams did not close: $($entry.Label)" }
      [IO.File]::WriteAllText((Join-Path $run ($entry.Label+'.stdout.log')),$entry.Stdout.Result)
      [IO.File]::WriteAllText((Join-Path $run ($entry.Label+'.stderr.log')),$entry.Stderr.Result)
    } catch {
      $cleanupErrors += $_.Exception.Message
    }
  }
  $after = @(Listeners)
  $metadataPorts = $fixedPorts + @($backendPort | Where-Object { $null -ne $_ })
  $record.listenersAfter = @($after | Where-Object LocalPort -in ($metadataPorts + $sharedPorts))
  $sharedBefore = @($before | Where-Object LocalPort -in $sharedPorts | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort):$($_.OwningProcess)" } | Sort-Object)
  $sharedAfter = @($after | Where-Object LocalPort -in $sharedPorts | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort):$($_.OwningProcess)" } | Sort-Object)
  $record.sharedListenersUnchanged = @(Compare-Object $sharedBefore $sharedAfter).Count -eq 0
  if ($cleanupErrors.Count) { $record.cleanupErrors = $cleanupErrors }
  $record.endedAt = [DateTimeOffset]::UtcNow.ToString('o')
  SaveReceipt 'processes-exited'
  if ($cleanupErrors.Count) { throw 'At least one owned process or stream did not close; inspect the receipt' }
  if (@($after | Where-Object LocalPort -in $metadataPorts).Count) {
    throw 'At least one dedicated port has a listener after cleanup; no additional process was stopped'
  }
  if (!$record.sharedListenersUnchanged) { throw 'A shared-port listener changed while the owned fixture was running' }
}
