# Entity Inspector GUI

ASCII/terminal-styled debugging interface for the Hytale Entity Inspector plugin.

```
╔══════════════════════════════════════════════════════════════════╗
║  █▀▀ █▄░█ ▀█▀ █ ▀█▀ █▄█   █ █▄░█ █▀ █▀█ █▀▀ █▀▀ ▀█▀ █▀█ █▀█      ║
║  ██▄ █░▀█ ░█░ █ ░█░ ░█░   █ █░▀█ ▄█ █▀▀ ██▄ █▄▄ ░█░ █▄█ █▀▄      ║
╚══════════════════════════════════════════════════════════════════╝
```

## Usage

1. Start the Hytale server with the Entity Inspector plugin
2. Open `index.html` in a browser
3. GUI auto-connects to `ws://localhost:8765`

## Features

- **Real-time entity tracking** - Spawn/despawn/update events
- **Component inspector** - Click entity to see all component data
- **Search/filter** - Filter by type, model, or ID
- **Auto-reconnect** - Automatically reconnects on disconnect
- **Event log** - Press `L` to toggle event log

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `R` | Reconnect to server |
| `C` | Clear local entity cache |
| `ESC` | Deselect entity / clear search |
| `L` | Toggle event log |
| `/` | Focus search box |
