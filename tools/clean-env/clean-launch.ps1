# Runs scripts/runReviewedTranslationBrowserEmulator.mjs in a CLEAN process environment, as the strict launcher
# requires. It sends ONLY the variables the launcher allows (SystemRoot, WINDIR, PATH=System32, synthetic profile and
# temp folders, the bootstrap variables). No credentials, no HOME/NODE_OPTIONS, nothing from the parent shell.
# It never loosens the launcher's checks; the launcher still rejects anything else.
# Usage: powershell -File tools/clean-env/clean-launch.ps1 -Boot <boot-dir> --check-environment|--prepare|--attest <manifest>|--run <manifest> <proof>
param([Parameter(Mandatory = $true)][string]$Boot, [Parameter(ValueFromRemainingArguments = $true)][string[]]$LauncherArgs)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
# Node 24.13.0 is pinned inside the launcher too; override only with LV_NODE24 pointing at that same binary.
$node = if ($env:LV_NODE24) { $env:LV_NODE24 } else { Join-Path $env:LOCALAPPDATA 'LinguistVision\tools\node-v24.13.0-win-x64\node.exe' }
$sys = $env:SystemRoot
$profile = Join-Path $Boot 'profile'; $temp = Join-Path $Boot 'temp'
$marker = (Get-Content (Join-Path $profile '.synthetic-bootstrap-owner') -Raw).Trim()
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $node; $psi.WorkingDirectory = $repo; $psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
$psi.Arguments = (@('scripts/runReviewedTranslationBrowserEmulator.mjs') + $LauncherArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
$psi.EnvironmentVariables.Clear()
$vars = @{
  SystemRoot = $sys; WINDIR = $sys; PATH = (Join-Path $sys 'System32')
  USERPROFILE = $profile; APPDATA = $profile; LOCALAPPDATA = $profile
  TEMP = $temp; TMP = $temp
  HOMEDRIVE = $profile.Substring(0, 2); HOMEPATH = $profile.Substring(2)
  SYSTEMDRIVE = $sys.Substring(0, 2); USERNAME = 'synthetic-review'; USERDOMAIN = 'SYNTHETIC'; LOGONSERVER = 'SYNTHETIC'
  LV_REVIEW_BROWSER_BOOTSTRAP = $Boot; LV_REVIEW_BROWSER_BOOTSTRAP_MARKER = $marker
}
foreach ($k in $vars.Keys) { $psi.EnvironmentVariables[$k] = $vars[$k] }
$p = [System.Diagnostics.Process]::Start($psi)
$out = $p.StandardOutput.ReadToEnd(); $err = $p.StandardError.ReadToEnd(); $p.WaitForExit()
$out
if ($err -and $err -notmatch '^#< CLIXML') { 'STDERR: ' + $err.Substring(0, [Math]::Min(1500, $err.Length)) }
'EXIT: ' + $p.ExitCode
exit $p.ExitCode
