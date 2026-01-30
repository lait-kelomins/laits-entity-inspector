# Lait's Entity Inspector - Auto Updater (Windows)
# Run: .\update.ps1
# Options: -Force (reinstall), -CheckOnly (just check), -Configure (reconfigure)

param(
    [switch]$Force,
    [switch]$CheckOnly,
    [switch]$Configure
)

$ErrorActionPreference = "Stop"
$REPO = "lait-kelomins/laits-entity-inspector"
$SCRIPT_DIR = $PSScriptRoot
$CONFIG_FILE = Join-Path $SCRIPT_DIR "updater-config.json"
$VERSION_FILE = Join-Path $SCRIPT_DIR "version.txt"

# Default paths
$DEFAULT_MOD_PATH = Join-Path $env:APPDATA "Hytale\UserData\Mods"

# Colors
function Write-Info { Write-Host "[INFO] " -ForegroundColor Cyan -NoNewline; Write-Host $args }
function Write-Success { Write-Host "[OK] " -ForegroundColor Green -NoNewline; Write-Host $args }
function Write-Warn { Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $args }
function Write-Err { Write-Host "[ERROR] " -ForegroundColor Red -NoNewline; Write-Host $args }

# Default config
$DEFAULT_CONFIG = @{
    modPath = ""
    autoCheck = $true
    lastCheck = $null
    skipModInstall = $false
}

# Load config
function Get-Config {
    if (Test-Path $CONFIG_FILE) {
        try {
            $json = Get-Content $CONFIG_FILE -Raw | ConvertFrom-Json
            $config = @{}
            foreach ($key in $DEFAULT_CONFIG.Keys) {
                if ($json.PSObject.Properties.Name -contains $key) {
                    $config[$key] = $json.$key
                } else {
                    $config[$key] = $DEFAULT_CONFIG[$key]
                }
            }
            return $config
        } catch {
            Write-Warn "Invalid config file, using defaults"
        }
    }
    return $DEFAULT_CONFIG.Clone()
}

# Save config
function Save-Config($config) {
    $config | ConvertTo-Json -Depth 10 | Set-Content $CONFIG_FILE -Encoding UTF8
}

# Prompt with default value
function Read-WithDefault($prompt, $default) {
    $displayDefault = if ($default) { " [$default]" } else { "" }
    $input = Read-Host "$prompt$displayDefault"
    if ([string]::IsNullOrWhiteSpace($input)) {
        return $default
    }
    return $input
}

# Prompt yes/no with default
function Read-YesNo($prompt, $default = $true) {
    $hint = if ($default) { "(Y/n)" } else { "(y/N)" }
    $input = Read-Host "$prompt $hint"
    if ([string]::IsNullOrWhiteSpace($input)) {
        return $default
    }
    return $input -match "^[yY]"
}

# Configure settings interactively
function Initialize-Config {
    param([hashtable]$config, [switch]$ForcePrompt)

    $needsSave = $false

    Write-Host ""
    Write-Host "=== Configuration ===" -ForegroundColor Yellow
    Write-Host ""

    # Mod path
    $detectedPath = $null
    if (Test-Path $DEFAULT_MOD_PATH) {
        $detectedPath = $DEFAULT_MOD_PATH
    }

    $currentPath = $config.modPath
    if ($ForcePrompt -or [string]::IsNullOrWhiteSpace($currentPath)) {
        if ($detectedPath) {
            Write-Success "Detected Hytale mods folder: $detectedPath"
            if (Read-YesNo "Use this path?") {
                $config.modPath = $detectedPath
                $needsSave = $true
            } else {
                $newPath = Read-WithDefault "Enter mods folder path (or 'skip' to skip mod updates)" $currentPath
                if ($newPath -eq "skip") {
                    $config.skipModInstall = $true
                    $config.modPath = ""
                } elseif (Test-Path $newPath) {
                    $config.modPath = $newPath
                    $config.skipModInstall = $false
                } else {
                    Write-Warn "Path not found, mod updates will be skipped"
                    $config.skipModInstall = $true
                }
                $needsSave = $true
            }
        } else {
            Write-Warn "Could not detect Hytale mods folder"
            $newPath = Read-WithDefault "Enter mods folder path (or 'skip' to skip mod updates)" $currentPath
            if ($newPath -eq "skip") {
                $config.skipModInstall = $true
                $config.modPath = ""
            } elseif ($newPath -and (Test-Path $newPath)) {
                $config.modPath = $newPath
                $config.skipModInstall = $false
            } else {
                if ($newPath) { Write-Warn "Path not found" }
                $config.skipModInstall = $true
            }
            $needsSave = $true
        }
    } else {
        Write-Info "Mod folder: $currentPath"
    }

    # Auto check
    if ($ForcePrompt) {
        $config.autoCheck = Read-YesNo "Enable automatic update checks?" $config.autoCheck
        $needsSave = $true
    }

    if ($needsSave) {
        Save-Config $config
        Write-Success "Configuration saved!"
    }

    Write-Host ""
    return $config
}

# Get current version
function Get-CurrentVersion {
    if (Test-Path $VERSION_FILE) {
        return (Get-Content $VERSION_FILE -Raw).Trim()
    }
    $appJs = Join-Path $SCRIPT_DIR "app.js"
    if (Test-Path $appJs) {
        $content = Get-Content $appJs -Raw
        if ($content -match "GUI_VERSION\s*=\s*['""]([^'""]+)['""]") {
            return $matches[1]
        }
    }
    return "0.0.0"
}

# Get latest release from GitHub
function Get-LatestRelease {
    $url = "https://api.github.com/repos/$REPO/releases/latest"
    try {
        return Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "LaitsUpdater" }
    } catch {
        Write-Err "Failed to fetch release info: $_"
        return $null
    }
}

# Download file
function Get-Download($url, $output) {
    Write-Info "Downloading: $(Split-Path $output -Leaf)"
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $url -OutFile $output -UseBasicParsing
}

# Main
function Update-Inspector {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host "  Lait's Entity Inspector - Updater" -ForegroundColor Magenta
    Write-Host "========================================" -ForegroundColor Magenta

    $config = Get-Config

    # Run configuration if needed or requested
    $isFirstRun = -not (Test-Path $CONFIG_FILE)
    if ($Configure -or $isFirstRun) {
        $config = Initialize-Config -config $config -ForcePrompt:($Configure -or $isFirstRun)
    }

    $currentVersion = Get-CurrentVersion
    Write-Info "Current version: v$currentVersion"

    Write-Info "Checking for updates..."
    $release = Get-LatestRelease
    if (-not $release) { return }

    $latestVersion = $release.tag_name -replace "^v", ""
    Write-Info "Latest version:  v$latestVersion"

    # Update last check time
    $config.lastCheck = (Get-Date).ToString("o")
    Save-Config $config

    if ($currentVersion -eq $latestVersion -and -not $Force) {
        Write-Success "Already up to date!"
        return
    }

    if ($CheckOnly) {
        Write-Warn "Update available: v$latestVersion"
        return
    }

    Write-Host ""
    Write-Success "Update available: v$currentVersion -> v$latestVersion"
    Write-Host ""
    if ($release.body) {
        Write-Host "Release notes:" -ForegroundColor Yellow
        Write-Host $release.body
        Write-Host ""
    }

    if (-not (Read-YesNo "Install update?")) {
        Write-Info "Update cancelled"
        return
    }

    # Setup temp dir
    $tempDir = Join-Path $env:TEMP "laits-updater-$(Get-Random)"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    try {
        # Download & extract GUI
        $guiAsset = $release.assets | Where-Object { $_.name -like "*gui*.zip" }
        if ($guiAsset) {
            $guiZip = Join-Path $tempDir $guiAsset.name
            Get-Download $guiAsset.browser_download_url $guiZip

            Write-Info "Extracting GUI..."
            Expand-Archive -Path $guiZip -DestinationPath "$tempDir\gui" -Force

            # Copy all except config files
            Get-ChildItem "$tempDir\gui" -File | Where-Object {
                $_.Name -notmatch "updater-config|version\.txt"
            } | ForEach-Object {
                Copy-Item $_.FullName -Destination $SCRIPT_DIR -Force
            }
            Write-Success "GUI updated!"
        }

        # Download & install mod
        if (-not $config.skipModInstall -and $config.modPath) {
            $modAsset = $release.assets | Where-Object { $_.name -like "*.jar" }
            if ($modAsset -and (Test-Path $config.modPath)) {
                $modJar = Join-Path $tempDir $modAsset.name
                Get-Download $modAsset.browser_download_url $modJar

                # Remove old versions
                Get-ChildItem $config.modPath -Filter "laits-entity-inspector-*.jar" -ErrorAction SilentlyContinue | Remove-Item -Force

                Copy-Item $modJar -Destination $config.modPath -Force
                Write-Success "Mod installed: $($config.modPath)\$($modAsset.name)"
            }
        } elseif ($config.skipModInstall) {
            Write-Info "Skipping mod installation (disabled in config)"
        }

        # Save version
        $latestVersion | Set-Content $VERSION_FILE

        Write-Host ""
        Write-Success "Update complete! Refresh the browser to use the new version."

    } finally {
        Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Update-Inspector
