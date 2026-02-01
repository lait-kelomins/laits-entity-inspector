# **Warning**: This is an experimental debugging tool intended for local development servers only. Do not use on production or public servers. Use at your own risk.

# Lait's Entity Inspector

![Entity Inspector Screenshot](https://media.forgecdn.net/attachments/1506/321/lei-standard-png.png)

Real-time entity debugging tools for Hytale modding.

---

## Installation

1. Clone the repo and run `laits-entity-inspector-gui/update.ps1` (Windows) or `update.sh` (Linux/Mac)
2. Enable the mod in-game
3. Open `laits-entity-inspector-gui/index.html` in a browser

Run the updater again on new releases for auto-updating - you'll be notified on the dashboard.

> **Hytalor Integration**: The inspector automatically detects when [Hytalor](https://www.curseforge.com/hytale/mods/hytalor) is loaded, unlocking the Asset Browser and live asset patching — apply changes to game assets without restarting the server.

---

## Features

### Entity Inspector
- **Real-time entity tracking** - Live spawn/despawn/update events
- **Component inspector** - Click any entity to inspect all component data
- **Deep expansion** - Click expandable fields to load nested data from server
- **Search & filter** - Filter entities by type, model, or ID
- **Component filter** - Filter components within the inspector panel
- **Live changes panel** - See which components are changing across all entities

### Packet Log
- **Network packet capture** - View all packets sent/received
- **Direction filtering** - Filter by inbound/outbound/all
- **Packet inspection** - Click packets to see full payload
- **Expandable fields** - Deep-expand complex packet data

### Asset Browser (requires Hytalor)
- **Auto-detection** - Automatically detects if Hytalor is loaded in-game
- **Live asset patching** - When Hytalor is present, publish patches that take effect immediately without restart
- **Browse all game assets** - Roles, Prefabs, Items, Blocks, etc.
- **Search assets** - Find assets by name across all categories
- **View asset JSON** - See the full asset definition
- **Navigation history** - Back/forward through viewed assets

### Alarms Panel
- **Entity alarm tracking** - See all alarms across entities
- **Remaining time** - Live countdown to alarm triggers
- **Sort options** - Sort by name, entity ID, or ready status
- **Change detection** - Highlights when alarms are modified

### Settings Persistence (v0.1.1+)
- All UI settings survive page refresh (tab, filters, pause states, sort modes)
- Caches automatically clear on disconnect to prevent stale data

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Toggle global pause (all panels) |
| `R` | Reconnect to server |
| `C` | Clear local caches |
| `Esc` | Deselect / clear search / close modal |
| `L` | Toggle event log |
| `P` | Toggle packet log panel |
| `S` | Toggle settings modal |
| `H` | Toggle header |
| `/` | Focus search (context-aware) |
| `E` | Switch to Entities tab |
| `A` | Switch to Assets tab |
| `W` | Switch to Alarms (Watch) tab |

---

## Server Commands

| Command | Description |
|---------|-------------|
| `/inspector` | Show inspector status |
| `/inspector on\|off` | Toggle inspector |
| `/inspector rate <ms>` | Set update interval |
| `/inspector pause\|resume` | Pause/resume updates |
| `/inspector reload` | Reload config |

---

## Configuration

### Updater Config

On first run, `update.ps1` creates `updater-config.json`:

```json
{
  "modPath": "C:\\Users\\...\\Hytale\\UserData\\Mods",
  "autoCheck": true,
  "skipModInstall": false
}
```

- `modPath` - Where to install the mod jar
- `autoCheck` - Check for updates automatically
- `skipModInstall` - Set to `true` to only update GUI

Reconfigure anytime with: `.\update.ps1 -Configure`

---

## Building from Source

```bash
cd laits-entity-inspector
gradle build -x test
```

Output: `build/libs/laits-entity-inspector-<version>.jar`

---

## Screenshots

![Entity List](https://media.forgecdn.net/attachments/1506/323/lei-assets-png.png)
![Component Inspector](https://media.forgecdn.net/attachments/1506/324/lei-patch-png.png)
![Alarms](https://media.forgecdn.net/attachments/1506/325/lei-alarms-png.png)

---

## License

MIT
