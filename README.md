# Lait's Entity Inspector

![alt text](https://media.forgecdn.net/attachments/1499/614/entityinspector-screen-png.png)

> **Warning**: This is an experimental debugging tool intended for local development servers only. Do not use on production or public servers. Use at your own risk.

Real-time entity debugging tools for Hytale modding.

***

## Components

# Entity Inspector Plugin

Hytale server plugin that collects live entity/component data via WebSocket.

**Features:**

*   Real-time entity spawn/despawn/update events
*   Component data serialization
*   WebSocket server on port 8765
*   Configurable update rate and entity filters

**Commands:**

*   `/inspector` - Show status
*   `/inspector on|off` - Toggle inspector
*   `/inspector rate <ms>` - Set update interval
*   `/inspector pause|resume` - Pause/resume updates
*   `/inspector reload` - Reload config

# Inspector Web UI (clone from github)

ASCII/terminal-styled web interface for viewing entity data.

**Features:**

*   Real-time entity list with animations
*   Component inspector panel
*   Search/filter entities
*   Auto-reconnect

***

## Quick Start

1.  Build the plugin:

```
   cd laits-entity-inspector
   gradle build -x test
```

Output: `build/libs/laits-entity-inspector-<version>.jar`

1.  Copy the JAR to your world's mods folder:

```
   %APPDATA%/Hytale/UserData/Saves/<world>/Mods/
```

1.  Start the Hytale server
    
2.  Open `laits-entity-inspector-gui/index.html` in a browser (clone it from github)

***

# Entity List with filters

![image](https://media.forgecdn.net/attachments/description/1446511/description_9abe1583-d693-41e3-b3db-581e7f2269c8.png)

# Component Inspector with filters

![image](https://media.forgecdn.net/attachments/description/1446511/description_403c2744-f014-40e1-ad00-0be97269a6bc.png)

***

## License

MIT