package com.laits.inspector.core;

import com.hypixel.hytale.logger.HytaleLogger;
import com.hypixel.hytale.server.core.universe.world.World;
import com.laits.inspector.config.InspectorConfig;
import com.laits.inspector.data.ComponentData;
import com.laits.inspector.data.EntitySnapshot;
import com.laits.inspector.data.PositionUpdate;
import com.laits.inspector.data.WorldSnapshot;
import com.laits.inspector.transport.DataTransport;
import com.laits.inspector.transport.DataTransportListener;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * Core orchestrator for the Entity Inspector.
 * Manages transports and coordinates data flow.
 */
public class InspectorCore implements DataTransportListener {
    private static final HytaleLogger LOGGER = HytaleLogger.forEnclosingClass();

    private final InspectorConfig config;
    private final EntityDataCollector collector;
    private final List<DataTransport> transports = new ArrayList<>();
    private final AtomicBoolean enabled = new AtomicBoolean(true);
    private final AtomicBoolean paused = new AtomicBoolean(false);

    // Cache for entity lookups by ID (LinkedHashMap preserves insertion order for LRU eviction)
    private final Map<Long, EntitySnapshot> entityCache = Collections.synchronizedMap(new LinkedHashMap<>());

    // Previous snapshots for change detection
    private final Map<Long, EntitySnapshot> previousSnapshots = new ConcurrentHashMap<>();

    // Lock object for cache operations requiring atomicity
    private final Object cacheLock = new Object();

    // Reference to current world for snapshot requests
    private volatile World currentWorld;

    public InspectorCore(InspectorConfig config) {
        this.config = config;
        this.collector = new EntityDataCollector(config);
    }

    /**
     * Add a transport for data output.
     */
    public void addTransport(DataTransport transport) {
        transports.add(transport);
        transport.setListener(this);
    }

    /**
     * Remove a transport.
     */
    public void removeTransport(DataTransport transport) {
        transports.remove(transport);
    }

    /**
     * Start all transports.
     */
    public void start() {
        for (DataTransport transport : transports) {
            try {
                transport.start(config);
            } catch (Exception e) {
                LOGGER.atWarning().log("Failed to start transport %s: %s",
                        transport.getClass().getSimpleName(), e.getMessage());
            }
        }
    }

    /**
     * Stop all transports.
     */
    public void stop() {
        for (DataTransport transport : transports) {
            try {
                transport.stop();
            } catch (Exception e) {
                LOGGER.atWarning().log("Error stopping transport %s: %s",
                        transport.getClass().getSimpleName(), e.getMessage());
            }
        }
        entityCache.clear();
        previousSnapshots.clear();
    }

    /**
     * Set the current world for snapshot requests.
     * Called when a world becomes available.
     */
    public void setCurrentWorld(World world) {
        this.currentWorld = world;
    }

    /**
     * Get the current world.
     */
    public World getCurrentWorld() {
        return currentWorld;
    }

    /**
     * Get the entity data collector.
     */
    public EntityDataCollector getCollector() {
        return collector;
    }

    // State management

    public boolean isEnabled() {
        return enabled.get() && config.isEnabled();
    }

    public void setEnabled(boolean value) {
        enabled.set(value);
        LOGGER.atInfo().log("Inspector %s", value ? "enabled" : "disabled");
    }

    public boolean isPaused() {
        return paused.get();
    }

    public void setPaused(boolean value) {
        paused.set(value);
        LOGGER.atInfo().log("Inspector %s", value ? "paused" : "resumed");
    }

    public int getUpdateIntervalTicks() {
        return config.getUpdateIntervalTicks();
    }

    public void setUpdateIntervalMs(int ms) {
        config.setUpdateIntervalMs(ms);
        LOGGER.atInfo().log("Update interval set to %dms (%d ticks)",
                config.getUpdateIntervalMs(), config.getUpdateIntervalTicks());
    }

    public int getConnectedClients() {
        return transports.stream()
                .mapToInt(DataTransport::getClientCount)
                .sum();
    }

    // Events from ECS systems

    /**
     * Called when a new entity spawns.
     * Must be called from world thread.
     */
    public void onEntitySpawn(EntitySnapshot snapshot) {
        if (!shouldProcess() || snapshot == null) {
            return;
        }

        putWithEviction(snapshot.getEntityId(), snapshot);
        broadcast(t -> t.sendEntitySpawn(snapshot));
    }

    /**
     * Called when an entity despawns.
     * Must be called from world thread.
     */
    public void onEntityDespawn(long entityId, String uuid) {
        if (!shouldProcess()) {
            return;
        }

        entityCache.remove(entityId);
        previousSnapshots.remove(entityId);
        broadcast(t -> t.sendEntityDespawn(entityId, uuid));
    }

    /**
     * Called when an entity's components change.
     * Must be called from world thread.
     */
    public void onEntityUpdate(EntitySnapshot snapshot) {
        if (!shouldProcess() || snapshot == null) {
            return;
        }

        // Detect which components changed
        List<String> changedComponents = detectChangedComponents(snapshot);

        putWithEviction(snapshot.getEntityId(), snapshot);
        previousSnapshots.put(snapshot.getEntityId(), snapshot);

        broadcast(t -> t.sendEntityUpdate(snapshot, changedComponents));
    }

    /**
     * Put an entity into the cache, evicting oldest entries if limit exceeded.
     */
    private void putWithEviction(long entityId, EntitySnapshot snapshot) {
        synchronized (cacheLock) {
            entityCache.put(entityId, snapshot);

            int maxSize = config.getMaxCachedEntities();
            while (entityCache.size() > maxSize) {
                Iterator<Long> it = entityCache.keySet().iterator();
                if (it.hasNext()) {
                    Long oldestId = it.next();
                    it.remove();
                    previousSnapshots.remove(oldestId);
                }
            }
        }
    }

    /**
     * Detect which components have changed compared to the previous snapshot.
     */
    private List<String> detectChangedComponents(EntitySnapshot current) {
        List<String> changed = new ArrayList<>();
        EntitySnapshot previous = previousSnapshots.get(current.getEntityId());

        if (previous == null) {
            // All components are new
            changed.addAll(current.getComponents().keySet());
        } else {
            // Find new or changed components
            for (var entry : current.getComponents().entrySet()) {
                ComponentData prevData = previous.getComponent(entry.getKey());
                if (prevData == null || !prevData.equals(entry.getValue())) {
                    changed.add(entry.getKey());
                }
            }
        }

        return changed;
    }

    /**
     * Called with batched position updates.
     * Must be called from world thread.
     */
    public void onPositionBatch(List<PositionUpdate> positions) {
        if (!shouldProcess() || positions == null || positions.isEmpty()) {
            return;
        }

        broadcast(t -> t.sendPositionBatch(positions));
    }

    // DataTransportListener implementation

    @Override
    public WorldSnapshot onRequestSnapshot(String worldId) {
        World world = currentWorld;
        if (world == null) {
            return null;
        }

        // Return cached entities as a snapshot
        return WorldSnapshot.builder()
                .worldId(world.getName())
                .worldName(world.getName())
                .entities(new ArrayList<>(entityCache.values()))
                .build();
    }

    @Override
    public EntitySnapshot onRequestEntity(long entityId) {
        return entityCache.get(entityId);
    }

    // Internal helpers

    private boolean shouldProcess() {
        return isEnabled() && !isPaused();
    }

    private void broadcast(Consumer<DataTransport> action) {
        for (DataTransport transport : transports) {
            if (transport.isRunning()) {
                try {
                    action.accept(transport);
                } catch (Exception e) {
                    // Silent - don't spam logs
                }
            }
        }
    }
}
