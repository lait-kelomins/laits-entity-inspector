#!/bin/bash
# Lait's Entity Inspector - Auto Updater (Linux/macOS)
# Run: ./update.sh
# Options: --force (reinstall), --check-only (just check), --configure (reconfigure)

set -e

REPO="lait-kelomins/laits-entity-inspector"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/updater-config.json"
VERSION_FILE="$SCRIPT_DIR/version.txt"

# Default paths (Linux/macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
    DEFAULT_MOD_PATH="$HOME/Library/Application Support/Hytale/UserData/Mods"
else
    DEFAULT_MOD_PATH="$HOME/.local/share/Hytale/UserData/Mods"
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

info() { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# Check dependencies
check_deps() {
    for cmd in curl unzip; do
        command -v $cmd &>/dev/null || error "$cmd is required"
    done
    if command -v jq &>/dev/null; then
        USE_JQ=true
    else
        warn "jq not found, using basic JSON parsing"
        USE_JQ=false
    fi
}

# JSON helpers
json_get() {
    local json="$1" key="$2"
    if $USE_JQ; then
        echo "$json" | jq -r "$key // empty" 2>/dev/null
    else
        echo "$json" | grep -oP "\"${key#.}\":\s*\"?\K[^\",}]+" 2>/dev/null | head -1
    fi
}

# Load config
load_config() {
    [[ -f "$CONFIG_FILE" ]] && cat "$CONFIG_FILE" || echo '{"modPath":"","autoCheck":true,"skipModInstall":false}'
}

# Save config
save_config() {
    local mod_path="$1" skip_mod="$2" auto_check="$3"
    local now=$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)
    cat > "$CONFIG_FILE" << EOF
{
  "modPath": "$mod_path",
  "autoCheck": $auto_check,
  "skipModInstall": $skip_mod,
  "lastCheck": "$now"
}
EOF
}

# Prompt with default
read_with_default() {
    local prompt="$1" default="$2" input
    if [[ -n "$default" ]]; then
        read -p "$prompt [$default]: " input
        echo "${input:-$default}"
    else
        read -p "$prompt: " input
        echo "$input"
    fi
}

# Prompt yes/no
read_yesno() {
    local prompt="$1" default="${2:-y}" input hint
    [[ "$default" == "y" ]] && hint="(Y/n)" || hint="(y/N)"
    read -p "$prompt $hint: " input
    input="${input:-$default}"
    [[ "$input" =~ ^[yY] ]]
}

# Configure settings
initialize_config() {
    local force_prompt="$1"
    local config=$(load_config)
    local mod_path=$(json_get "$config" "modPath")
    local skip_mod=$(json_get "$config" "skipModInstall")
    local auto_check=$(json_get "$config" "autoCheck")

    [[ "$skip_mod" != "true" ]] && skip_mod="false"
    [[ "$auto_check" != "false" ]] && auto_check="true"

    echo ""
    echo -e "${YELLOW}=== Configuration ===${NC}"
    echo ""

    # Mod path
    if [[ "$force_prompt" == "true" || -z "$mod_path" ]]; then
        if [[ -d "$DEFAULT_MOD_PATH" ]]; then
            success "Detected Hytale mods folder: $DEFAULT_MOD_PATH"
            if read_yesno "Use this path?"; then
                mod_path="$DEFAULT_MOD_PATH"
                skip_mod="false"
            else
                mod_path=$(read_with_default "Enter mods folder path (or 'skip')" "$mod_path")
                if [[ "$mod_path" == "skip" ]]; then
                    skip_mod="true"
                    mod_path=""
                elif [[ -d "$mod_path" ]]; then
                    skip_mod="false"
                else
                    warn "Path not found, mod updates will be skipped"
                    skip_mod="true"
                    mod_path=""
                fi
            fi
        else
            warn "Could not detect Hytale mods folder"
            mod_path=$(read_with_default "Enter mods folder path (or 'skip')" "$mod_path")
            if [[ "$mod_path" == "skip" ]]; then
                skip_mod="true"
                mod_path=""
            elif [[ -n "$mod_path" && -d "$mod_path" ]]; then
                skip_mod="false"
            else
                [[ -n "$mod_path" ]] && warn "Path not found"
                skip_mod="true"
                mod_path=""
            fi
        fi
    else
        info "Mod folder: $mod_path"
    fi

    # Auto check
    if [[ "$force_prompt" == "true" ]]; then
        read_yesno "Enable automatic update checks?" "y" && auto_check="true" || auto_check="false"
    fi

    save_config "$mod_path" "$skip_mod" "$auto_check"
    success "Configuration saved!"
    echo ""
}

# Get current version
get_current_version() {
    if [[ -f "$VERSION_FILE" ]]; then
        tr -d '[:space:]' < "$VERSION_FILE"
        return
    fi
    if [[ -f "$SCRIPT_DIR/app.js" ]]; then
        grep -oP "GUI_VERSION\s*=\s*['\"]\\K[^'\"]+" "$SCRIPT_DIR/app.js" 2>/dev/null || echo "0.0.0"
        return
    fi
    echo "0.0.0"
}

# Main
main() {
    local force=false check_only=false configure=false

    for arg in "$@"; do
        case $arg in
            --force) force=true ;;
            --check-only) check_only=true ;;
            --configure) configure=true ;;
        esac
    done

    echo ""
    echo -e "${MAGENTA}========================================${NC}"
    echo -e "${MAGENTA}  Lait's Entity Inspector - Updater${NC}"
    echo -e "${MAGENTA}========================================${NC}"

    check_deps

    # Run configuration if needed
    local is_first_run=false
    [[ ! -f "$CONFIG_FILE" ]] && is_first_run=true

    if $configure || $is_first_run; then
        initialize_config "true"
    fi

    local config=$(load_config)
    local current=$(get_current_version)
    info "Current version: v$current"

    info "Checking for updates..."
    local release=$(curl -s "https://api.github.com/repos/$REPO/releases/latest")
    [[ -z "$release" ]] && error "Failed to fetch release info"

    local latest=$(json_get "$release" "tag_name" | sed 's/^v//')
    info "Latest version:  v$latest"

    # Update last check
    local mod_path=$(json_get "$config" "modPath")
    local skip_mod=$(json_get "$config" "skipModInstall")
    local auto_check=$(json_get "$config" "autoCheck")
    [[ "$skip_mod" != "true" ]] && skip_mod="false"
    [[ "$auto_check" != "false" ]] && auto_check="true"
    save_config "$mod_path" "$skip_mod" "$auto_check"

    if [[ "$current" == "$latest" ]] && ! $force; then
        success "Already up to date!"
        exit 0
    fi

    if $check_only; then
        warn "Update available: v$latest"
        exit 0
    fi

    echo ""
    success "Update available: v$current -> v$latest"
    echo ""

    local body=$(json_get "$release" "body")
    if [[ -n "$body" ]]; then
        echo -e "${YELLOW}Release notes:${NC}"
        echo "$body"
        echo ""
    fi

    read_yesno "Install update?" || { info "Cancelled"; exit 0; }

    local temp_dir=$(mktemp -d)
    trap "rm -rf '$temp_dir'" EXIT

    # Get asset URLs
    local gui_url mod_url mod_name
    if $USE_JQ; then
        gui_url=$(echo "$release" | jq -r '.assets[] | select(.name | contains("gui")) | .browser_download_url')
        mod_url=$(echo "$release" | jq -r '.assets[] | select(.name | endswith(".jar")) | .browser_download_url')
        mod_name=$(echo "$release" | jq -r '.assets[] | select(.name | endswith(".jar")) | .name')
    else
        gui_url=$(echo "$release" | grep -oP '"browser_download_url":\s*"\K[^"]+gui[^"]+' | head -1)
        mod_url=$(echo "$release" | grep -oP '"browser_download_url":\s*"\K[^"]+\.jar' | head -1)
        mod_name=$(echo "$release" | grep -oP '"name":\s*"\K[^"]+\.jar' | head -1)
    fi

    # Download & extract GUI
    if [[ -n "$gui_url" ]]; then
        info "Downloading GUI..."
        curl -sL -o "$temp_dir/gui.zip" "$gui_url"

        info "Extracting..."
        unzip -q "$temp_dir/gui.zip" -d "$temp_dir/gui"

        # Copy files (except config)
        find "$temp_dir/gui" -maxdepth 1 -type f ! -name "*config*" ! -name "version.txt" -exec cp {} "$SCRIPT_DIR/" \;
        success "GUI updated!"
    fi

    # Download & install mod
    if [[ "$skip_mod" != "true" && -n "$mod_path" && -d "$mod_path" && -n "$mod_url" ]]; then
        info "Downloading mod..."
        curl -sL -o "$temp_dir/$mod_name" "$mod_url"

        rm -f "$mod_path"/laits-entity-inspector-*.jar
        cp "$temp_dir/$mod_name" "$mod_path/"
        success "Mod installed: $mod_path/$mod_name"
    elif [[ "$skip_mod" == "true" ]]; then
        info "Skipping mod installation (disabled in config)"
    fi

    echo "$latest" > "$VERSION_FILE"

    echo ""
    success "Update complete! Refresh the browser to use the new version."
}

main "$@"
