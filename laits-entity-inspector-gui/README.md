# Entity Inspector GUI

ASCII/terminal-styled web interface for the Hytale Entity Inspector plugin.

## Usage

1. Start the Hytale server with the Entity Inspector plugin
2. Open `index.html` in a browser
3. GUI auto-connects to `ws://localhost:8765`

## Updating

```powershell
.\update.ps1           # Normal update
.\update.ps1 -Force    # Force reinstall
.\update.ps1 -Configure # Reconfigure mod path
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Toggle global pause |
| `R` | Reconnect |
| `C` | Clear caches |
| `Esc` | Deselect / close |
| `L` | Toggle event log |
| `P` | Toggle packet log |
| `S` | Settings |
| `H` | Toggle header |
| `/` | Focus search |
| `E` | Entities tab |
| `A` | Assets tab |
| `W` | Alarms tab |

See the [main README](../README.md) for full documentation.
