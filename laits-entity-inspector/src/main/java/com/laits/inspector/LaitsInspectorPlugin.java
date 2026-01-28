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
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Main plugin class for the Entity Inspector.
 * Provides live entity/component data via WebSocket.
 */
public class LaitsInspectorPlugin extends JavaPlugin {
    private static final HytaleLogger LOGGER = HytaleLogger.forEnclosingClass();
    private static final String VERSION = "0.0.1";

    private static LaitsInspectorPlugin INSTANCE;

    private InspectorConfig config;
    private InspectorCore core;
    private EntityUpdateSystem updateSystem;
    private ScheduledExecutorService scheduler;
    private ScheduledFuture<?> tickTask;

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

        // Start tick handler for position updates
        startTickHandler();

        // Try to get initial world
        setupWorld();

        LOGGER.atInfo().log("Entity Inspector started - WebSocket on port %d",
                config.getWebsocket().getPort());
    }

    @Override
    protected void shutdown() {
        // Stop tick handler
        if (tickTask != null) {
            tickTask.cancel(true);
        }
        if (scheduler != null) {
            scheduler.shutdownNow();
        }

        if (core != null) {
            core.stop();
        }
        LOGGER.atInfo().log("Entity Inspector stopped");
    }

    /**
     * Start the tick handler to flush position batches periodically.
     */
    private void startTickHandler() {
        scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "InspectorTick");
            t.setDaemon(true);
            return t;
        });

        tickTask = scheduler.scheduleAtFixedRate(() -> {
            World world = core.getCurrentWorld();
            if (world != null && updateSystem != null) {
                world.execute(() -> updateSystem.flushPositionBatch());
            }
        }, 0, 50, TimeUnit.MILLISECONDS);
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
