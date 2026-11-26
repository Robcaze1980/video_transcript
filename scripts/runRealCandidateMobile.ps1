$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Compiles the actual candidate and runs one synthetic browser story. The
# child environment is constructed before Node starts; no credentials are read.
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$node = if ($env:LV_NODE24) { $env:LV_NODE24 } else { 'C:/Users/rob62/AppData/Local/LinguistVision/tools/node-v24.13.0-win-x64/node.exe' }
$node = (Resolve-Path -LiteralPath $node).Path
$nodeDir = Split-Path -Parent $node
$npm = Join-Path $nodeDir 'node_modules/npm/bin/npm-cli.js'
if (-not (Test-Path -LiteralPath $npm -PathType Leaf)) { throw 'Node 24.13 with npm is required.' }
$outputs = Join-Path $workspace 'outputs'
[void][System.IO.Directory]::CreateDirectory($outputs)
$task = Join-Path $outputs ('browser-real-build-' + [guid]::NewGuid().ToString())
$profile = Join-Path $task 'profile'
$temp = Join-Path $task 'temp'
$bundle = Join-Path $task 'bundle'
[void][System.IO.Directory]::CreateDirectory($profile)
[void][System.IO.Directory]::CreateDirectory($temp)
$systemRoot = $env:SystemRoot
if (-not $systemRoot -or -not (Test-Path -LiteralPath (Join-Path $systemRoot 'System32') -PathType Container)) { throw 'Windows system directory unavailable.' }
$clean = @{
  SystemRoot=$systemRoot; WINDIR=$systemRoot; PATH=($nodeDir + ';' + (Join-Path $systemRoot 'System32'))
  USERPROFILE=$profile; APPDATA=$profile; LOCALAPPDATA=$profile; TEMP=$temp; TMP=$temp
  HOMEDRIVE=$profile.Substring(0,2); HOMEPATH=$profile.Substring(2)
  SYSTEMDRIVE=([System.IO.Path]::GetPathRoot($systemRoot)).Substring(0,2)
  USERNAME='synthetic-review'; USERDOMAIN='SYNTHETIC'; LOGONSERVER='SYNTHETIC'
}
function Invoke-CleanNode([string]$arguments,[hashtable]$environment,[string]$label) {
  $psi=[System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName=$node
  $psi.Arguments=$arguments
  $psi.WorkingDirectory=$workspace
  $psi.UseShellExecute=$false
  $psi.CreateNoWindow=$true
  $psi.RedirectStandardOutput=$true
  $psi.RedirectStandardError=$true
  $psi.EnvironmentVariables.Clear()
  foreach($key in $environment.Keys){$psi.EnvironmentVariables[$key]=$environment[$key]}
  $child=[System.Diagnostics.Process]::Start($psi)
  $out=$child.StandardOutput.ReadToEndAsync()
  $err=$child.StandardError.ReadToEndAsync()
  $child.WaitForExit()
  $stdout=$out.GetAwaiter().GetResult()
  $stderr=$err.GetAwaiter().GetResult()
  [System.IO.File]::WriteAllText((Join-Path $task ($label + '.stdout.txt')),$stdout,[System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText((Join-Path $task ($label + '.stderr.txt')),$stderr,[System.Text.UTF8Encoding]::new($false))
  if($child.ExitCode -ne 0){Write-Output $stdout;Write-Output $stderr;throw "$label failed; evidence: $task"}
  Write-Output $stdout
}
$buildEnv=$clean.Clone()
$buildEnv['CI']='true'
$buildEnv['npm_config_update_notifier']='false'
Invoke-CleanNode ('"' + $npm + '" run build:candidate -- --outDir "' + $bundle + '"') $buildEnv 'build'
$testEnv=$clean.Clone()
$testEnv['LV_REAL_CANDIDATE_TASK']=$task
Invoke-CleanNode 'scripts/qaRealCandidateMobile.browser.mjs' $testEnv 'browser'
Write-Output "Synthetic candidate evidence: $task"
