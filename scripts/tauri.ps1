# Runs the Tauri CLI with a working Windows build environment.
#
# Two things bite on Windows and neither error message points at its cause:
#   1. `cargo` lives in %USERPROFILE%\.cargo\bin. rustup persists that to the
#      user PATH, but shells opened before the install have a stale copy, and
#      you get "program not found" from `cargo metadata`.
#   2. The MSVC linker is only on PATH inside a Developer prompt. Without it
#      you get "linker `link.exe` not found", which looks like a Rust problem
#      and is not.
#
# This script fixes both, then hands off to the Tauri CLI.
#
#   powershell -ExecutionPolicy Bypass -File scripts/tauri.ps1 dev
#   powershell -ExecutionPolicy Bypass -File scripts/tauri.ps1 build
#
# Or just use `npm run tauri:dev` / `npm run tauri:build`, which call this.

param([Parameter(ValueFromRemainingArguments = $true)][string[]] $TauriArgs)

$ErrorActionPreference = "Stop"

# --- 1. cargo -------------------------------------------------------------
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path (Join-Path $cargoBin "cargo.exe")) {
    if ($env:Path -notlike "*$cargoBin*") { $env:Path = "$cargoBin;$env:Path" }
} elseif (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "cargo not found. Install Rust from https://rustup.rs and reopen the terminal."
}

# --- 2. MSVC toolchain ----------------------------------------------------
# VCINSTALLDIR is set by vcvars/VsDevCmd, so if it is present we are already
# inside a developer environment and can skip the (slow) import.
if (-not $env:VCINSTALLDIR) {
    # There can be several Visual Studio installs and not all of them can
    # actually link: a VS install carrying only the MSVC compiler has
    # vcvars64.bat but NOT the vcvarsall.bat it delegates to, so sourcing it
    # fails silently and you are left without link.exe. Require the sibling,
    # and verify the import really produced a linker before accepting it.
    $candidates = @(Get-ChildItem `
        "C:\Program Files*\Microsoft Visual Studio\*\*\VC\Auxiliary\Build\vcvars64.bat" `
        -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.DirectoryName "vcvarsall.bat") })

    if ($candidates.Count -eq 0) {
        throw @"
No usable vcvars64.bat found - the Visual C++ build tools are incomplete.

A Visual Studio install can have the MSVC compiler without the Windows SDK and
without vcvarsall.bat; that cannot link. Install the "Desktop development with
C++" workload:

  winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
"@
    }

    $ok = $false
    foreach ($vcvars in $candidates) {
        cmd /c "`"$($vcvars.FullName)`" >nul 2>&1 && set" | ForEach-Object {
            if ($_ -match '^([^=]+)=(.*)$') {
                Set-Item -Path "env:$($matches[1])" -Value $matches[2] -ErrorAction SilentlyContinue
            }
        }
        if (Get-Command link.exe -ErrorAction SilentlyContinue) { $ok = $true; break }
    }
    if (-not $ok) {
        throw "Sourced vcvars64.bat but link.exe is still not on PATH. Check the Windows SDK installation."
    }
}

if (-not (Test-Path "C:\Program Files (x86)\Windows Kits\10")) {
    Write-Warning "Windows SDK not found at the usual path; linking may fail."
}

# --- 3. go ----------------------------------------------------------------
if (-not $TauriArgs -or $TauriArgs.Count -eq 0) { $TauriArgs = @("--help") }
Write-Host "cargo:  $((Get-Command cargo).Source)" -ForegroundColor DarkGray
Write-Host "linker: $((Get-Command link.exe -ErrorAction SilentlyContinue).Source)" -ForegroundColor DarkGray
Write-Host "tauri $($TauriArgs -join ' ')" -ForegroundColor DarkGray

& npx tauri @TauriArgs
exit $LASTEXITCODE
