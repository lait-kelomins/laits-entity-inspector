# Laits Entity Inspector

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

2. Deploy JAR to: `%APPDATA%/Hytale/userdata/saves/<world>/mods/`

3. Start the Hytale server

4. Open `laits-entity-inspector-gui/index.html` in a browser

## License

MIT
