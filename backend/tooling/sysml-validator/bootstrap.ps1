param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ToolsDir = Join-Path $RepoRoot ".tools"
$BundleDir = Join-Path $ToolsDir "sysml-pilot-0.62.0"
$ZipPath = Join-Path $ToolsDir "jupyter-sysml-kernel-0.62.0.zip"

$AssetUrl = "https://github.com/Systems-Modeling/SysML-v2-Pilot-Implementation/releases/download/2026-08/jupyter-sysml-kernel-0.62.0.zip"
$ExpectedSha256 = "5a015ed3f2b3d2dae14e9c3fb9602d9e1fef5f9ce33cf396c422329405cc3cb2"

foreach ($command in @("java", "javac")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command '$command' was not found on PATH."
    }
}

$JavaVersion = (& java -version 2>&1 | Select-Object -First 1)
if ($JavaVersion -notmatch 'version "21(\.|")') {
    throw "Java 21 is required. Found: $JavaVersion"
}

New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null

if ($Force) {
    if (Test-Path $BundleDir) {
        Remove-Item -Recurse -Force $BundleDir
    }
    if (Test-Path $ZipPath) {
        Remove-Item -Force $ZipPath
    }
}

if (-not (Test-Path $BundleDir)) {
    if (-not (Test-Path $ZipPath)) {
        Write-Host "Downloading official SysML v2 Pilot 0.62.0 bundle..."
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $AssetUrl -OutFile $ZipPath
    }

    $ActualSha256 = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualSha256 -ne $ExpectedSha256) {
        Remove-Item -Force $ZipPath
        throw "Checksum mismatch for Pilot bundle. Expected $ExpectedSha256 but found $ActualSha256."
    }

    New-Item -ItemType Directory -Force -Path $BundleDir | Out-Null
    Expand-Archive -Path $ZipPath -DestinationPath $BundleDir -Force
}

$SysMLBundleDir = Join-Path $BundleDir "sysml"
$AllJar = Get-ChildItem $SysMLBundleDir -Filter "jupyter-sysml-kernel-*-all.jar" |
    Sort-Object Name |
    Select-Object -First 1
$LibraryDir = Join-Path $SysMLBundleDir "sysml.library"

if (-not $AllJar) {
    throw "Could not find the official shaded kernel JAR under $SysMLBundleDir."
}

if (-not (Test-Path $LibraryDir)) {
    throw "Could not find the official SysML library under $LibraryDir."
}

$Source = Join-Path $PSScriptRoot "src\main\java\io\github\huaiguo\sysmlvalidator\ValidatorMain.java"
$ClassesDir = Join-Path $PSScriptRoot "build\classes"

if (Test-Path $ClassesDir) {
    Remove-Item -Recurse -Force $ClassesDir
}
New-Item -ItemType Directory -Force -Path $ClassesDir | Out-Null

Write-Host "Compiling sysml-agent validator adapter..."
& javac "-cp" $AllJar.FullName "-d" $ClassesDir $Source
if ($LASTEXITCODE -ne 0) {
    throw "Validator adapter compilation failed."
}

Write-Host ""
Write-Host "Validator bootstrap complete."
Write-Host "Official release: 2026-08 / 0.62.0"
Write-Host "Bundle SHA256: $ExpectedSha256"
Write-Host "Runtime JAR: $($AllJar.FullName)"
Write-Host "SysML library: $LibraryDir"
Write-Host ""
Write-Host "Run smoke tests:"
Write-Host "  .\tooling\sysml-validator\smoke-test.ps1"
