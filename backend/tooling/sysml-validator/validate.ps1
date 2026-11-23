param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Path
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$BundleDir = Join-Path $RepoRoot ".tools\sysml-pilot-0.62.0\sysml"
$ClassesDir = Join-Path $PSScriptRoot "build\classes"
$LibraryDir = Join-Path $BundleDir "sysml.library"

if (-not (Test-Path $ClassesDir)) {
    throw "Validator has not been bootstrapped. Run .\tooling\sysml-validator\bootstrap.ps1 first."
}

$AllJar = Get-ChildItem $BundleDir -Filter "jupyter-sysml-kernel-*-all.jar" |
    Sort-Object Name |
    Select-Object -First 1

if (-not $AllJar) {
    throw "Official Pilot runtime JAR not found. Run bootstrap.ps1 first."
}

if (-not (Test-Path $LibraryDir)) {
    throw "SysML library directory not found: $LibraryDir"
}

$ModelPath = (Resolve-Path $Path).Path
$ClassPath = "$ClassesDir;$($AllJar.FullName)"

$JavaArgs = @(
    "-cp",
    $ClassPath,
    "io.github.huaiguo.sysmlvalidator.ValidatorMain",
    "--library",
    $LibraryDir,
    "--file",
    $ModelPath
)

& java @JavaArgs
exit $LASTEXITCODE
