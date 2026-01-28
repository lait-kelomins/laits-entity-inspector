# Laits Entity Inspector

> **Warning**: This is an experimental debugging tool intended for local development servers only. Do not use on production or public servers. Use at your own risk.

Real-time entity debugging tools for Hytale modding.

## Components

### laits-entity-inspector (Plugin)

Hytale server plugin that collects live entity/component data via WebSocket.

**Features:**
- Real-time entity spawn/despawn/update events
- Component data serialization
- WebSocket server on port 8765
- Configurable update rate and entity filters

**Commands:**
- `/inspector` - Show status
- `/inspector on|off` - Toggle inspector
- `/inspector rate <ms>` - Set update interval
- `/inspector pause|resume` - Pause/resume updates
- `/inspector reload` - Reload config

### laits-entity-inspector-gui (Web UI)

ASCII/terminal-styled web interface for viewing entity data.

**Features:**
- Real-time entity list with animations
- Component inspector panel
- Search/filter entities
- Auto-reconnect

## Quick Start

1. Build the plugin:
   ```bash
   cd laits-entity-inspector
   gradle build -x test
   ```
   Output: `build/libs/laits-entity-inspector-<version>.jar`

2. Copy the JAR to your world's mods folder:
   ```
   %APPDATA%/Hytale/UserData/Saves/<world>/Mods/
   ```

3. Start the Hytale server

4. Open `laits-entity-inspector-gui/index.html` in a browser

## License

MIT
