package com.laits.inspector;

import com.hypixel.hytale.logger.HytaleLogger;
import com.hypixel.hytale.server.core.plugin.JavaPlugin;
import com.hypixel.hytale.server.core.plugin.JavaPluginInit;
import com.hypixel.hytale.server.core.universe.Universe;
import com.hypixel.hytale.server.core.universe.world.World;
import com.laits.inspector.commands.InspectorCommand;
import com.laits.inspector.config.InspectorConfig;
import com.laits.inspector.core.InspectorCore;
import com.laits.inspector.systems.EntityLifecycleSystem;
import com.laits.inspector.systems.EntityUpdateSystem;
import com.laits.inspector.transport.websocket.WebSocketTransport;

import javax.annotation.Nonnull;
import java.nio.file.Path;

/**
 * Main plugin class for the Entity Inspector.
 * Provides live entity/component data via WebSocket.
 */
public class LaitsInspectorPlugin extends JavaPlugin {
    private static final HytaleLogger LOGGER = HytaleLogger.forEnclosingClass();
    private static final String VERSION = "1.0.0";

    private static LaitsInspectorPlugin INSTANCE;

    private InspectorConfig config;
    private InspectorCore core;
    private EntityUpdateSystem updateSystem;

    public LaitsInspectorPlugin(@Nonnull JavaPluginInit init) {
        super(init);
        INSTANCE = this;
    }

    public static LaitsInspectorPlugin get() {
        return INSTANCE;
    }

    public InspectorCore getCore() {
        return core;
    }

    public InspectorConfig getInspectorConfig() {
        return config;
    }

    @Override
    protected void setup() {
        // Load configuration
        Path configPath = this.getDataDirectory().resolve("config.json");
        config = InspectorConfig.load(configPath);

        // Create core
        core = new InspectorCore(config);

        // Add WebSocket transport
        core.addTransport(new WebSocketTransport());

        // Register commands
        this.getCommandRegistry().registerCommand(new InspectorCommand(core, config));
        this.getCommandRegistry().registerCommand(new InspectorCommand(core, config, "insp")); // shortcut

        LOGGER.atInfo().log("Entity Inspector v%s loaded", VERSION);
    }

    @Override
    protected void start() {
        // Register ECS systems
        EntityLifecycleSystem lifecycleSystem = new EntityLifecycleSystem(core);
        updateSystem = new EntityUpdateSystem(core);

        this.getEntityStoreRegistry().registerSystem(lifecycleSystem);
        this.getEntityStoreRegistry().registerSystem(updateSystem);

        // Start transports
        core.start();

        // Try to get initial world
        setupWorld();

        LOGGER.atInfo().log("Entity Inspector started - WebSocket on port %d",
                config.getWebsocket().getPort());
    }

    @Override
    protected void shutdown() {
        if (core != null) {
            core.stop();
        }
        LOGGER.atInfo().log("Entity Inspector stopped");
    }

    /**
     * Set up the world reference for the inspector.
     * Called during start and can be called when world changes.
     */
    private void setupWorld() {
        try {
            Universe universe = Universe.get();
            if (universe != null) {
                // Get the default world
                World world = universe.getDefaultWorld();
                if (world != null) {
                    core.setCurrentWorld(world);
                    LOGGER.atInfo().log("Inspector monitoring world: %s", world.getName());
                }
            }
        } catch (Exception e) {
            LOGGER.atWarning().log("Could not get initial world: %s", e.getMessage());
        }
    }

    /**
     * Called each server tick to flush position updates.
     * Should be hooked into the server tick event.
     */
    public void onServerTick() {
        if (updateSystem != null) {
            updateSystem.flushPositionBatch();
        }
    }
}
