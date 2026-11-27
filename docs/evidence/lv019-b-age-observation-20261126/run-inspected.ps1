param(
  [Parameter(Mandatory)][string]$Node,
  [Parameter(Mandatory)][string]$Jdk,
  [Parameter(Mandatory)][string]$Jar,
  [Parameter(Mandatory)][string]$Manifest
)
$ErrorActionPreference = 'Stop'
if (!$IsWindows) { throw 'Windows runner only' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$nodePath = (Resolve-Path -LiteralPath $Node).Path
$jdkPath = (Resolve-Path -LiteralPath $Jdk).Path
$jarPath = (Resolve-Path -LiteralPath $Jar).Path
$manifestPath = (Resolve-Path -LiteralPath $Manifest).Path
$javaPath = Join-Path $jdkPath 'bin/java.exe'
$javacPath = Join-Path $jdkPath 'bin/javac.exe'
$manifestTool = Join-Path $PSScriptRoot 'manifest.mjs'
$fixture = Join-Path $repo 'server/commercial/overdueEntryContinuity.diagnostic.emulator.mjs'
$inspector = Join-Path $PSScriptRoot 'InspectOwnedFirestore.java'
$guard = Join-Path $repo 'docs/evidence/lv019-b-entry-continuity-20261126/network-guard.cjs'
$rules = Join-Path $repo 'deploy/google-cloud/firestore.rules'
foreach ($file in $javaPath,$javacPath,$nodePath,$jarPath,$manifestPath,$fixture,$inspector,$guard,$rules,$manifestTool) {
  if (!(Test-Path -LiteralPath $file -PathType Leaf)) { throw 'A required input is missing' }
}
function Sha256($File) { (Get-FileHash -Algorithm SHA256 -LiteralPath $File).Hash.ToLowerInvariant() }
if ((Sha256 $jarPath) -ne 'c3d3680a89d946a90a027365ea14c26c6472a162bcf37f099bbb1ebd66d25e8e') { throw 'Unexpected JAR' }
$manifestSha=Sha256 $manifestPath
$project='demo-vistavo-admission';$address='127.0.0.1';$fixedPorts=@(8197,9197,9297);$sharedPorts=@(8185,8186,8187)
function Listeners {
  @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Sort-Object LocalPort,LocalAddress,OwningProcess |
    Select-Object LocalAddress,LocalPort,OwningProcess)
}
$before=@(Listeners)
if (@($before | Where-Object LocalPort -in $fixedPorts).Count) { throw 'A dedicated port is already in use' }
$nonce=[guid]::NewGuid().ToString()
$run=Join-Path $repo "outputs/age-observation-runs/run-$nonce"
$profile=Join-Path $run 'profile';$temp=Join-Path $run 'temp';$classes=Join-Path $run 'classes'
$ready=Join-Path $run 'ready.txt';$stop=Join-Path $run 'stop.txt'
New-Item -ItemType Directory -Path $profile,$temp,$classes -Force | Out-Null
if (@(Get-ChildItem -Force -LiteralPath $profile).Count -or @(Get-ChildItem -Force -LiteralPath $temp).Count) { throw 'Profile and temp must start empty' }
$record=[ordered]@{
  startedAt=[DateTimeOffset]::UtcNow.ToString('o');project=$project;address=$address;nonce=$nonce
  fixedPorts=$fixedPorts;grpcBackendPort=$null;manifest=$manifestPath;manifestSha256=$manifestSha
  listenersBefore=@($before | Where-Object LocalPort -in ($fixedPorts+$sharedPorts));listenerProofs=@()
  environmentKeys=@();stage='prepared';ownedJavaPid=$null;ownedNodePid=$null;nodeExit=$null
  javaStoppedByNonce=$false;processReceipts=@();terminatedTrees=@();sharedPortsUnchanged=$null;failure=$null
}
function SaveReceipt($Stage) {
  $record.stage=$Stage
  $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $run 'run.json') -Encoding utf8
}
SaveReceipt 'prepared'
Write-Output "Evidence: $run"
function Launch($Executable,[string[]]$Arguments,$Label,$WorkingDirectory) {
  $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$Executable;$start.WorkingDirectory=$WorkingDirectory
  $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
  $start.Environment.Clear()
  foreach($item in @{
    SystemRoot=$env:SystemRoot;WINDIR=$env:SystemRoot;PATH=(Join-Path $env:SystemRoot 'System32')
    USERPROFILE=$profile;LOCALAPPDATA=$profile;APPDATA=$profile;TEMP=$temp;TMP=$temp
    NODE_ENV='test';LV_REVIEW_CONTRACT='1';LV_FINANCIAL_REGRESSION='1';METADATA_SERVER_DETECTION='none'
    GOOGLE_CLOUD_PROJECT=$project;GCLOUD_PROJECT=$project;FIRESTORE_EMULATOR_HOST="$($address):8197"
  }.GetEnumerator()) {$start.Environment[$item.Key]=$item.Value}
  foreach($argument in $Arguments){$start.ArgumentList.Add($argument)}
  $record.environmentKeys+=@{process=$Label;keys=@($start.Environment.Keys | Sort-Object)}
  $process=[Diagnostics.Process]::Start($start)
  [pscustomobject]@{Process=$process;Label=$Label;Stdout=$process.StandardOutput.ReadToEndAsync();Stderr=$process.StandardError.ReadToEndAsync()}
}
function CheckListeners($Label,[int[]]$Expected) {
  $now=@(Listeners);$owned=@($now | Where-Object OwningProcess -eq $record.ownedJavaPid)
  $tracked=@($now | Where-Object LocalPort -in $Expected)
  $record.listenerProofs+=@{phase=$Label;owned=$owned;tracked=$tracked};SaveReceipt $Label
  if($owned.Count -ne $Expected.Count -or $tracked.Count -ne $Expected.Count -or
    @($owned | Where-Object {$_.LocalAddress -ne $address -or $_.LocalPort -notin $Expected}).Count) {
    throw 'The exact listeners are not exclusively on the owned IPv4 loopback JVM'
  }
}
function WaitBounded($Process,[int]$Seconds) {
  $deadline=[DateTimeOffset]::UtcNow.AddSeconds($Seconds)
  while(!$Process.HasExited -and [DateTimeOffset]::UtcNow -lt $deadline){[void]$Process.WaitForExit(1000)}
  return $Process.HasExited
}
function Descendants([int]$ProcessId) {
  $all=@(Get-CimInstance Win32_Process -ErrorAction Stop);$parents=@($ProcessId);$found=@()
  $seen=[Collections.Generic.HashSet[int]]::new();[void]$seen.Add($ProcessId)
  while($parents.Count){
    $next=@($all | Where-Object { $_.ParentProcessId -in $parents -and $seen.Add([int]$_.ProcessId) })
    if(!$next.Count){break};$found+=$next;$parents=@($next | ForEach-Object { [int]$_.ProcessId })
  }
  return @($found | Select-Object ProcessId,ParentProcessId,Name,CreationDate)
}
function Capture($entry) {
  if($null -eq $entry){return}
  if(!$entry.Process.HasExited){
    $children=@(Descendants $entry.Process.Id)
    $record.terminatedTrees+=@{label=$entry.Label;root=$entry.Process.Id;descendants=$children}
    $entry.Process.Kill($true)
  }
  if(!$entry.Process.WaitForExit(5000)){throw "Owned process did not exit: $($entry.Label)"}
  $record.processReceipts+=@{label=$entry.Label;id=$entry.Process.Id;exit=$entry.Process.ExitCode}
  [IO.File]::WriteAllText((Join-Path $run ($entry.Label+'.stdout.log')),$entry.Stdout.Result)
  [IO.File]::WriteAllText((Join-Path $run ($entry.Label+'.stderr.log')),$entry.Stderr.Result)
}
$verifyBefore=$null;$compile=$null;$java=$null;$client=$null;$verifyAfter=$null;$backendPort=$null
$javaOpts=@("-Duser.home=$profile","-Djava.io.tmpdir=$temp")
try {
  $verifyBefore=Launch $nodePath @($manifestTool,'verify',$jdkPath,$jarPath,$manifestPath) 'verify-before' $repo
  if(!(WaitBounded $verifyBefore.Process 180) -or $verifyBefore.Process.ExitCode -ne 0){throw 'Frozen input verification failed before fixture'}
  if((Sha256 $manifestPath) -ne $manifestSha){throw 'Manifest changed before fixture'}
  $compile=Launch $javacPath @("-J$($javaOpts[0])","-J$($javaOpts[1])",'-proc:none','-cp',$jarPath,'-d',$classes,$inspector) 'compile' $run
  if(!$compile.Process.WaitForExit(15000) -or $compile.Process.ExitCode -ne 0){throw 'Inspector compilation failed'}
  $java=Launch $javaPath ($javaOpts+@('-cp',"$classes;$jarPath",'InspectOwnedFirestore',$ready,$stop,$nonce,$rules)) 'emulator' $run
  $record.ownedJavaPid=$java.Process.Id;SaveReceipt 'java-started';Write-Output "Owned Java PID $($java.Process.Id)"
  $deadline=[DateTimeOffset]::UtcNow.AddSeconds(15)
  while(!(Test-Path -LiteralPath $ready -PathType Leaf)){
    if($java.Process.HasExited -or [DateTimeOffset]::UtcNow -ge $deadline){throw 'Owned JVM did not attest its socket'}
    Start-Sleep -Milliseconds 100
  }
  $reported=@(Get-Content -LiteralPath $ready)
  if($reported.Count -ne 5 -or $reported[0] -cne $nonce -or $reported[1] -ne "$($java.Process.Id)" -or
    $reported[2] -cne $project -or $reported[3] -cne $address -or $reported[4] -notmatch '^[0-9]{1,5}$'){throw 'Unexpected JVM readiness record'}
  $backendPort=[int]$reported[4];$record.grpcBackendPort=$backendPort
  if($backendPort -lt 1024 -or $backendPort -gt 65535 -or $backendPort -in ($fixedPorts+$sharedPorts) -or $before.LocalPort -contains $backendPort){throw 'Private gRPC port overlaps an existing listener'}
  $expected=$fixedPorts+@($backendPort);CheckListeners 'before-fixture' $expected
  $client=Launch $nodePath @('--no-network-family-autoselection','--require',$guard,'--import','tsx','--test','--test-concurrency=1',
    '--test-isolation=none','--test-reporter=tap',$fixture) 'fixture' $repo
  $record.ownedNodePid=$client.Process.Id;SaveReceipt 'fixture-started';Write-Output "Owned Node PID $($client.Process.Id)"
  $nodeStart=$client.Process.StartTime;$record.nodeStart=$nodeStart.ToString('o')
  if(!(WaitBounded $client.Process 180)){throw 'Fixture timed out; preserve its evidence and do not automatically retry'}
  $nodeExit=$client.Process.ExitTime;$record.nodeExitTime=$nodeExit.ToString('o')
  $record.nodeDescendantsAfterExit=@(Descendants $client.Process.Id)
  if($record.nodeDescendantsAfterExit.Count){
    throw 'A possible child survived the fixture; it was not touched and the run is incomplete'
  }
  $record.nodeExit=$client.Process.ExitCode;CheckListeners 'after-fixture' $expected
  $output=$client.Stdout.Result+"`n"+$client.Stderr.Result
  if($record.nodeExit -ne 0 -or $output -match 'VISTAVO_REVIEW_NETWORK_DENIED' -or
    $output -notmatch 'VISTAVO_FINANCIAL_NETWORK_GUARD_ACTIVE SELF_CHECK=PASS' -or
    $output -notmatch '(?m)^# tests 10\s*$' -or $output -notmatch '(?m)^# pass 10\s*$' -or
    $output -notmatch '(?m)^# fail 0\s*$' -or $output -notmatch '(?m)^# cancelled 0\s*$' -or
    $output -notmatch '(?m)^# skipped 0\s*$' -or $output -notmatch 'Synthetic fixture cleanup verified: 10/10; roots 0->0'){
    throw 'Fixture or root cleanup was incomplete'
  }
  $verifyAfter=Launch $nodePath @($manifestTool,'verify',$jdkPath,$jarPath,$manifestPath) 'verify-after' $repo
  if(!(WaitBounded $verifyAfter.Process 180) -or $verifyAfter.Process.ExitCode -ne 0 -or (Sha256 $manifestPath) -ne $manifestSha){throw 'Frozen input verification failed after fixture'}
  SaveReceipt 'fixture-complete'
} catch {$record.failure=$_.Exception.Message;throw}
finally {
  if($java -and !$java.Process.HasExited -and (Test-Path -LiteralPath $ready -PathType Leaf)){
    [IO.File]::WriteAllText($stop,$nonce);$record.javaStoppedByNonce=$java.Process.WaitForExit(6500)
  }
  $cleanupErrors=@()
  foreach($entry in @($client,$java,$compile,$verifyAfter,$verifyBefore)){
    try{Capture $entry}catch{$cleanupErrors+=$_.Exception.Message}
  }
  $after=@(Listeners);$ownPorts=$fixedPorts+@($backendPort | Where-Object {$null -ne $_})
  $record.listenersAfter=@($after | Where-Object LocalPort -in ($ownPorts+$sharedPorts));$record.endedAt=[DateTimeOffset]::UtcNow.ToString('o')
  $sharedBefore=@($before | Where-Object LocalPort -in $sharedPorts | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort):$($_.OwningProcess)" } | Sort-Object)
  $sharedAfter=@($after | Where-Object LocalPort -in $sharedPorts | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort):$($_.OwningProcess)" } | Sort-Object)
  $record.sharedPortsUnchanged=(($sharedBefore -join '|') -ceq ($sharedAfter -join '|'))
  if($cleanupErrors.Count){$record.cleanupErrors=$cleanupErrors}
  SaveReceipt 'processes-exited'
  if($cleanupErrors.Count){throw 'At least one owned process could not be stopped; see the run receipt'}
  if(@($after | Where-Object LocalPort -in $ownPorts).Count){throw 'A dedicated listener remains; no other process was stopped'}
  if(!$record.sharedPortsUnchanged){throw 'A shared listener changed; no other process was stopped'}
}
