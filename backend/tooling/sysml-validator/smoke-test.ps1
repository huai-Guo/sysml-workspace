param(
    [switch]$Bootstrap
)

$ErrorActionPreference = "Stop"

if ($Bootstrap) {
    & (Join-Path $PSScriptRoot "bootstrap.ps1")
}

$ValidateScript = Join-Path $PSScriptRoot "validate.ps1"
$PowerShellExecutable = (Get-Process -Id $PID).Path

function Invoke-ValidatorCase {
    param(
        [string]$Name,
        [string]$Fixture,
        [int]$ExpectedExit,
        [bool]$ExpectedValid,
        [string]$ExpectedKind
    )

    $RunId = [guid]::NewGuid().ToString("N")
    $StdoutPath = Join-Path ([IO.Path]::GetTempPath()) "sysml-validator-$RunId.stdout"
    $StderrPath = Join-Path ([IO.Path]::GetTempPath()) "sysml-validator-$RunId.stderr"
    try {
        & $PowerShellExecutable -NoProfile -File $ValidateScript $Fixture `
            1> $StdoutPath 2> $StderrPath
        $ExitCode = $LASTEXITCODE
        $Stdout = Get-Content -LiteralPath $StdoutPath -Raw
        $Stderr = Get-Content -LiteralPath $StderrPath -Raw -ErrorAction SilentlyContinue

        if ($ExitCode -ne $ExpectedExit) {
            throw "\${Name}: expected exit $ExpectedExit, got $ExitCode. Stdout: $Stdout Stderr: $Stderr"
        }

        try {
            $Result = $Stdout | ConvertFrom-Json
        }
        catch {
            throw "\${Name}: validator stdout was not valid JSON. Stdout: $Stdout Stderr: $Stderr"
        }

        if ([bool]$Result.valid -ne $ExpectedValid) {
            throw "\${Name}: expected valid=$ExpectedValid, got $($Result.valid)."
        }

        if ($ExpectedKind) {
            $Matching = @($Result.diagnostics | Where-Object { $_.kind -eq $ExpectedKind })
            if ($Matching.Count -eq 0) {
                $Kinds = @($Result.diagnostics | ForEach-Object { $_.kind })
                throw "\${Name}: expected diagnostic kind '$ExpectedKind'. Got: $($Kinds -join ', ')"
            }

            $First = $Matching[0]
            if ($null -eq $First.line -or $null -eq $First.column) {
                throw "\${Name}: expected line/column on '$ExpectedKind' diagnostic."
            }
            if ($First.source -ne "omg-pilot") {
                throw "\${Name}: expected source=omg-pilot, got '$($First.source)'."
            }
        }

        if ($Result.validator.name -ne "omg-sysml-v2-pilot" -or $Result.validator.version -ne "0.62.0" -or $Result.validator.tag -ne "2026-08") {
            throw "\${Name}: unexpected validator metadata."
        }

        Write-Host "PASS $Name"
    }
    finally {
        Remove-Item -LiteralPath $StdoutPath, $StderrPath -ErrorAction SilentlyContinue
    }
}

$FixtureRoot = Join-Path $PSScriptRoot "fixtures"

$ValidCase = @{
    Name = "valid"
    Fixture = Join-Path $FixtureRoot "valid\simple-part.sysml"
    ExpectedExit = 0
    ExpectedValid = $true
    ExpectedKind = ""
}
Invoke-ValidatorCase @ValidCase

$SyntaxCase = @{
    Name = "syntax-error"
    Fixture = Join-Path $FixtureRoot "invalid\syntax-error.sysml"
    ExpectedExit = 1
    ExpectedValid = $false
    ExpectedKind = "syntax"
}
Invoke-ValidatorCase @SyntaxCase

$SemanticCase = @{
    Name = "semantic-error"
    Fixture = Join-Path $FixtureRoot "invalid\semantic-error.sysml"
    ExpectedExit = 1
    ExpectedValid = $false
    ExpectedKind = "semantic"
}
Invoke-ValidatorCase @SemanticCase

Write-Host "All validator smoke tests passed."
exit 0
