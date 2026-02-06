package com.laits.inspector.core;

import com.hypixel.hytale.component.Store;
import com.hypixel.hytale.logger.HytaleLogger;
import com.hypixel.hytale.server.core.modules.time.WorldTimeResource;
import com.hypixel.hytale.server.core.universe.world.World;
import com.hypixel.hytale.server.core.universe.world.storage.EntityStore;
import com.laits.inspector.cache.InMemoryCache;
import com.laits.inspector.cache.InspectorCache;
import com.laits.inspector.config.InspectorConfig;
import com.laits.inspector.data.*;
import com.laits.inspector.data.asset.*;
import com.laits.inspector.protocol.OutgoingMessage;
import com.laits.inspector.transport.DataTransport;
import com.laits.inspector.transport.DataTransportListener;

import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;
import java.util.stream.Collectors;

/**
 * Core orchestrator for the Entity Inspector.
 * Manages transports and coordinates data flow.
 */
public class InspectorCore implements DataTransportListener {
    private static final HytaleLogger LOGGER = HytaleLogger.forEnclosingClass();

    private final InspectorConfig config;
    private final EntityDataCollector collector;
    private final InspectorCache cache;
    private final List<DataTransport> transports = new ArrayList<>();
    private final AtomicBoolean enabled = new AtomicBoolean(true);
    private final AtomicBoolean paused = new AtomicBoolean(false);
    private final AtomicBoolean packetLogPaused = new AtomicBoolean(false);

    // Previous snapshots for change detection (bounded to prevent memory leaks)
    private final Map<Long, EntitySnapshot> previousSnapshots = Collections.synchronizedMap(new LinkedHashMap<>());
    private final Object previousSnapshotsLock = new Object();

    // Reference to current world for snapshot requests
    private volatile World currentWorld;

    // Asset browser and Hytalor services
    private final AssetCollector assetCollector;
    private final HytalorDetector hytalorDetector;
    private final PatchManager patchManager;
    private final SessionHistoryTracker historyTracker;

    // Entity query service
    private final EntityQueryService entityQueryService;

    // Track the last patched asset path for auto-refresh targeting
    private volatile String lastPatchedAssetPath;

    public InspectorCore(InspectorConfig config) {
        this(config, new InMemoryCache());
    }

    public InspectorCore(InspectorConfig config, InspectorCache cache) {
        this.config = config;
        this.collector = new EntityDataCollector(config);
        this.cache = cache;
        this.cache.setLimits(config.getMaxCachedEntities(), config.getMaxCachedPackets());

        // Initialize asset browser and Hytalor services
        this.assetCollector = new AssetCollector();
        this.hytalorDetector = new HytalorDetector();
        this.patchManager = new PatchManager();
        this.historyTracker = new SessionHistoryTracker();

        // Initialize entity query service with game time supplier
        this.entityQueryService = new EntityQueryService(this.cache);
        this.entityQueryService.setGameTimeSupplier(this::getCurrentGameTimeEpochMilli);
    }

    /**
     * Initialize asset browser and Hytalor detection.
     * Should be called after server is fully loaded.
     */
    public void initializeAssetBrowser() {
        LOGGER.atInfo().log("Initializing asset browser...");

        // Detect Hytalor
        hytalorDetector.detect();

        // Initialize patch manager
        patchManager.initialize(
                hytalorDetector.getDraftDirectory(),
                hytalorDetector.getPatchDirectory()
        );

        // Set up callback to broadcast when automatic refreshes complete
        assetCollector.setOnRefreshComplete(() -> {
            String patchedPath = this.lastPatchedAssetPath;
            this.lastPatchedAssetPath = null; // Clear after use
            LOGGER.atInfo().log("Auto-refresh complete, broadcasting to clients (patched: %s)", patchedPath);
            broadcast(t -> t.broadcast(OutgoingMessage.assetsRefreshed(patchedPath).toJson()));
        });

        // Initialize asset collector (uses AssetRegistry internally)
        // This does immediate scan + schedules grace period refresh
        assetCollector.initialize();

        LOGGER.atInfo().log("Asset browser initialized. Hytalor: %s",
                hytalorDetector.isHytalorPresent() ? "ENABLED" : "DISABLED");
    }

    /**
     * Get the cache (for testing or direct access).
     */
    public InspectorCache getCache() {
        return cache;
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
        cache.clear();
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
     * Get the current game time in epoch milliseconds.
     * Returns null if world is not available.
     */
    public Long getCurrentGameTimeEpochMilli() {
        World world = currentWorld;
        if (world == null) {
            return null;
        }

        try {
            var entityStore = world.getEntityStore();
            if (entityStore == null) {
                return null;
            }

            Store<EntityStore> store = entityStore.getStore();
            if (store == null) {
                return null;
            }

            WorldTimeResource timeResource = store.getResource(WorldTimeResource.getResourceType());
            if (timeResource == null || timeResource.getGameTime() == null) {
                return null;
            }

            return timeResource.getGameTime().toEpochMilli();
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to get game time: %s", e.getMessage());
            return null;
        }
    }

    /**
     * Get the game time rate (game seconds per real second).
     * For example, 72.0 means game time runs at 72x real time speed.
     * Returns null if world is not available.
     */
    public Double getGameTimeRate() {
        World world = currentWorld;
        if (world == null) {
            return null;
        }

        try {
            return WorldTimeResource.getSecondsPerTick(world);
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to get game time rate: %s", e.getMessage());
            return null;
        }
    }

    /**
     * Get the entity data collector.
     */
    public EntityDataCollector getCollector() {
        return collector;
    }

    /**
     * Refresh a single entity's data on-demand by collecting it from the world thread.
     * This avoids the periodic polling that was causing alarm resets.
     *
     * @param entityId The entity ID to refresh
     * @return Fresh EntitySnapshot, or cached snapshot if refresh fails
     */
    public EntitySnapshot refreshEntity(long entityId) {
        if (!config.getDebug().isOnDemandRefresh()) {
            return cache.getEntitySnapshot(entityId);
        }

        World world = currentWorld;
        if (world == null) {
            return cache.getEntitySnapshot(entityId);
        }

        CompletableFuture<EntitySnapshot> future = new CompletableFuture<>();
        world.execute(() -> {
            try {
                EntityDataCollector.CollectionResult result = collector.collectEntityById(entityId, world);
                if (result != null && result.snapshot() != null) {
                    cache.putEntity(entityId, result.snapshot(), result.componentRefs());
                    future.complete(result.snapshot());
                } else {
                    future.complete(cache.getEntitySnapshot(entityId));
                }
            } catch (Exception e) {
                LOGGER.atWarning().log("Failed to refresh entity %d: %s", entityId, e.getMessage());
                future.complete(cache.getEntitySnapshot(entityId));
            }
        });

        try {
            return future.get(2, TimeUnit.SECONDS);
        } catch (Exception e) {
            LOGGER.atWarning().log("Timeout refreshing entity %d, returning cached data", entityId);
            return cache.getEntitySnapshot(entityId);
        }
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

    public boolean isPacketLogPaused() {
        return packetLogPaused.get();
    }

    public void setPacketLogPaused(boolean value) {
        packetLogPaused.set(value);
        LOGGER.atInfo().log("Packet logging %s", value ? "paused" : "resumed");
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
        onEntitySpawn(snapshot, null);
    }

    /**
     * Called when a new entity spawns with component references for expansion.
     * Must be called from world thread.
     */
    public void onEntitySpawn(EntitySnapshot snapshot, Map<String, Object> componentObjects) {
        if (!shouldProcess() || snapshot == null || !config.getDebug().isEntityLifecycle()) {
            return;
        }

        cache.putEntity(snapshot.getEntityId(), snapshot, componentObjects);
        broadcast(t -> t.sendEntitySpawn(snapshot));
    }

    /**
     * Called when an entity despawns.
     * Must be called from world thread.
     */
    public void onEntityDespawn(long entityId, String uuid) {
        if (!shouldProcess() || !config.getDebug().isEntityLifecycle()) {
            return;
        }

        cache.removeEntity(entityId);
        previousSnapshots.remove(entityId);
        broadcast(t -> t.sendEntityDespawn(entityId, uuid));
    }

    /**
     * Called when an entity's components change.
     * Must be called from world thread.
     */
    public void onEntityUpdate(EntitySnapshot snapshot) {
        onEntityUpdate(snapshot, null);
    }

    /**
     * Called when an entity's components change with component references for expansion.
     * Must be called from world thread.
     */
    public void onEntityUpdate(EntitySnapshot snapshot, Map<String, Object> componentObjects) {
        if (!shouldProcess() || snapshot == null) {
            return;
        }

        // Detect which components changed
        List<String> changedComponents = detectChangedComponents(snapshot);

        cache.putEntity(snapshot.getEntityId(), snapshot, componentObjects);

        // Update previous snapshots with eviction to prevent memory leak
        synchronized (previousSnapshotsLock) {
            previousSnapshots.put(snapshot.getEntityId(), snapshot);
            int maxEntities = config.getMaxCachedEntities();
            while (previousSnapshots.size() > maxEntities) {
                Iterator<Long> it = previousSnapshots.keySet().iterator();
                if (it.hasNext()) {
                    it.next();
                    it.remove();
                }
            }
        }

        broadcast(t -> t.sendEntityUpdate(snapshot, changedComponents));
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

    // Counter for periodic time sync (every ~3 seconds at 20 TPS)
    private int timeSyncCounter = 0;
    private static final int TIME_SYNC_INTERVAL_TICKS = 60;

    /**
     * Called with batched position updates.
     * Must be called from world thread.
     */
    public void onPositionBatch(List<PositionUpdate> positions) {
        if (!shouldProcess() || positions == null || positions.isEmpty()) {
            return;
        }

        broadcast(t -> t.sendPositionBatch(positions));

        // Periodically send time sync to keep client interpolation accurate
        timeSyncCounter++;
        if (timeSyncCounter >= TIME_SYNC_INTERVAL_TICKS) {
            timeSyncCounter = 0;
            Long gameTime = getCurrentGameTimeEpochMilli();
            Double gameRate = getGameTimeRate();
            broadcast(t -> t.sendTimeSync(gameTime, gameRate));
        }
    }

    /**
     * Called when a network packet is captured.
     * Can be called from any thread.
     */
    public void onPacketLog(PacketLogEntry entry) {
        onPacketLog(entry, null);
    }

    /**
     * Called when a network packet is captured with original packet object for expansion.
     * Can be called from any thread.
     */
    public void onPacketLog(PacketLogEntry entry, Object originalPacket) {
        if (!shouldProcess() || entry == null) {
            return;
        }

        // Check if packet logging is enabled
        if (!config.getPacketLog().isEnabled()) {
            return;
        }

        // Check if packet log is paused (don't cache or send new packets)
        if (isPacketLogPaused()) {
            return;
        }

        // Check if this packet type is excluded
        if (config.getPacketLog().isPacketExcluded(entry.getPacketName())) {
            return;
        }

        // Cache the original packet for expansion
        if (originalPacket != null) {
            cache.putPacket(entry, originalPacket);
        }

        broadcast(t -> t.sendPacketLog(entry));
    }

    // DataTransportListener implementation

    @Override
    public WorldSnapshot onRequestSnapshot(String worldId) {
        World world = currentWorld;
        if (world == null) {
            return null;
        }

        // Return cached entities as a snapshot with current game time and server version
        return WorldSnapshot.builder()
                .worldId(world.getName())
                .worldName(world.getName())
                .entities(new ArrayList<>(cache.getAllEntities()))
                .gameTimeEpochMilli(getCurrentGameTimeEpochMilli())
                .gameTimeRate(getGameTimeRate())
                .serverVersion(com.laits.inspector.LaitsInspectorPlugin.VERSION)
                .build();
    }

    @Override
    public EntitySnapshot onRequestEntity(long entityId) {
        return cache.getEntitySnapshot(entityId);
    }

    @Override
    public InspectorConfig onConfigUpdate(Map<String, Object> updates) {
        if (updates == null || updates.isEmpty()) {
            return config;
        }

        try {
            // Apply updates to config
            for (var entry : updates.entrySet()) {
                applyConfigUpdate(entry.getKey(), entry.getValue());
            }

            // Save config
            config.save();

            LOGGER.atInfo().log("Configuration updated: %s", updates.keySet());

            // Broadcast updated config to all clients
            broadcastConfigSync();

            return config;
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to update config: %s", e.getMessage());
            return null;
        }
    }

    @Override
    public InspectorConfig getConfig() {
        return config;
    }

    @Override
    public Object onRequestExpand(long entityId, String path) {
        if (!config.getDebug().isLazyExpansion()) {
            return null;
        }
        LOGGER.atInfo().log("Expand request: entityId=%d, path=%s", entityId, path);
        Object result = cache.expandEntityPath(entityId, path);
        LOGGER.atInfo().log("Expand result: %s", result != null ? "success" : "null");
        return result;
    }

    /**
     * Handle expand request for packet data.
     */
    @Override
    public Object onRequestPacketExpand(long packetId, String path) {
        if (!config.getDebug().isLazyExpansion()) {
            return null;
        }
        LOGGER.atInfo().log("Packet expand request: packetId=%d, path=%s", packetId, path);
        Object result = cache.expandPacketPath(packetId, path);
        LOGGER.atInfo().log("Packet expand result: %s", result != null ? "success" : "null");
        return result;
    }

    /**
     * Apply a single config update.
     */
    @SuppressWarnings("unchecked")
    private void applyConfigUpdate(String key, Object value) {
        switch (key) {
            case "enabled" -> config.setEnabled((Boolean) value);
            case "updateIntervalTicks" -> config.setUpdateIntervalTicks(((Number) value).intValue());
            case "includeNPCs" -> config.setIncludeNPCs((Boolean) value);
            case "includePlayers" -> config.setIncludePlayers((Boolean) value);
            case "includeItems" -> config.setIncludeItems((Boolean) value);
            case "maxCachedEntities" -> config.setMaxCachedEntities(((Number) value).intValue());

            case "websocketEnabled" -> config.getWebsocket().setEnabled((Boolean) value);
            case "websocketMaxClients" -> config.getWebsocket().setMaxClients(((Number) value).intValue());

            case "packetLogEnabled" -> config.getPacketLog().setEnabled((Boolean) value);
            case "packetLogExcluded" -> {
                if (value instanceof List<?> list) {
                    config.getPacketLog().setExcludedPackets(
                        list.stream()
                            .map(Object::toString)
                            .collect(Collectors.toList())
                    );
                }
            }

            case "debug.positionTracking" -> config.getDebug().setPositionTracking((Boolean) value);
            case "debug.entityLifecycle" -> config.getDebug().setEntityLifecycle((Boolean) value);
            case "debug.onDemandRefresh" -> config.getDebug().setOnDemandRefresh((Boolean) value);
            case "debug.alarmInspection" -> config.getDebug().setAlarmInspection((Boolean) value);
            case "debug.timerInspection" -> config.getDebug().setTimerInspection((Boolean) value);
            case "debug.instructionInspection" -> config.getDebug().setInstructionInspection((Boolean) value);
            case "debug.lazyExpansion" -> config.getDebug().setLazyExpansion((Boolean) value);
            case "debug.assetBrowser" -> config.getDebug().setAssetBrowser((Boolean) value);
            case "debug.patchManagement" -> config.getDebug().setPatchManagement((Boolean) value);
            case "debug.entityActions" -> config.getDebug().setEntityActions((Boolean) value);

            default -> LOGGER.atWarning().log("Unknown config key: %s", key);
        }
    }

    /**
     * Broadcast current configuration to all connected clients.
     */
    public void broadcastConfigSync() {
        broadcast(t -> t.sendConfigSync(config));
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

    // ═══════════════════════════════════════════════════════════════
    // ASSET BROWSER IMPLEMENTATION
    // ═══════════════════════════════════════════════════════════════

    @Override
    public FeatureInfo getFeatureInfo() {
        return FeatureInfo.builder()
                .hytalorEnabled(hytalorDetector.isHytalorPresent())
                .draftDirectory(hytalorDetector.getDraftDirectoryString())
                .patchDirectory(hytalorDetector.getPatchDirectoryString())
                .patchAssetPackName(hytalorDetector.getPatchAssetPackName())
                .build();
    }

    @Override
    public List<AssetCategory> getAssetCategories() {
        if (!config.getDebug().isAssetBrowser()) {
            return Collections.emptyList();
        }
        return assetCollector.getCategories();
    }

    @Override
    public List<AssetEntry> getAssets(String category, String filter) {
        if (!config.getDebug().isAssetBrowser()) {
            return Collections.emptyList();
        }
        return assetCollector.getAssets(category, filter);
    }

    @Override
    public AssetDetail getAssetDetail(String category, String assetId) {
        if (!config.getDebug().isAssetBrowser()) {
            return null;
        }
        return assetCollector.getAssetDetail(category, assetId);
    }

    @Override
    public List<AssetEntry> searchAssets(String query) {
        if (!config.getDebug().isAssetBrowser()) {
            return Collections.emptyList();
        }
        return assetCollector.searchAllAssets(query);
    }

    @Override
    public Object onRequestAssetExpand(String category, String assetId, String path) {
        if (!config.getDebug().isAssetBrowser()) {
            return null;
        }
        // TODO: Implement asset field expansion
        return null;
    }

    @Override
    public void refreshAssets() {
        if (!config.getDebug().isAssetBrowser()) {
            return;
        }
        LOGGER.atInfo().log("Refreshing assets (immediate)...");
        assetCollector.refresh();
        // Broadcast refresh complete to all clients
        broadcast(t -> t.broadcast(OutgoingMessage.assetsRefreshed().toJson()));
    }

    /**
     * Schedule a delayed asset refresh (used after patch publish).
     * The delay allows time for patches to be applied before re-scanning.
     */
    public void scheduleDelayedRefresh() {
        LOGGER.atInfo().log("Scheduling delayed asset refresh after patch...");
        assetCollector.scheduleDelayedRefresh();
        // Callback will broadcast when complete
    }

    // ═══════════════════════════════════════════════════════════════
    // HYTALOR PATCHING IMPLEMENTATION
    // ═══════════════════════════════════════════════════════════════

    @Override
    public List<String> testWildcard(String wildcardPath) {
        if (!config.getDebug().isAssetBrowser()) {
            return Collections.emptyList();
        }
        return assetCollector.testWildcard(wildcardPath);
    }

    @Override
    public String generatePatch(String baseAssetPath, Map<String, Object> original,
                                 Map<String, Object> modified, String operation) {
        if (!config.getDebug().isPatchManagement()) {
            return "Patch management is disabled via debug config";
        }
        return patchManager.generatePatchFromDiff(baseAssetPath, original, modified, operation);
    }

    @Override
    public String saveDraft(String filename, String patchJson) {
        if (!config.getDebug().isPatchManagement()) {
            return "Patch management is disabled via debug config";
        }
        try {
            patchManager.saveDraft(filename, patchJson);

            // Extract base path for history
            String basePath = extractBaseAssetPath(patchJson);
            historyTracker.recordPatch(filename, basePath, "draft");

            return null; // Success
        } catch (Exception e) {
            return e.getMessage();
        }
    }

    @Override
    public String publishPatch(String filename, String patchJson) {
        if (!config.getDebug().isPatchManagement()) {
            return "Patch management is disabled via debug config";
        }
        LOGGER.atInfo().log("Publishing patch: %s", filename);
        try {
            patchManager.publishPatch(filename, patchJson);

            // Extract base path for history and auto-refresh targeting
            String basePath = extractBaseAssetPath(patchJson);
            historyTracker.recordPatch(filename, basePath, "publish");

            // Store for auto-refresh targeting (client will refresh this asset)
            this.lastPatchedAssetPath = basePath;

            LOGGER.atInfo().log("Patch published successfully: %s", filename);

            // Schedule delayed refresh to pick up patch changes
            scheduleDelayedRefresh();

            return null; // Success
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to publish patch %s: %s", filename, e.getMessage());
            return e.getMessage();
        }
    }

    @Override
    public List<PatchDraft> listDrafts() {
        if (!config.getDebug().isPatchManagement()) {
            return Collections.emptyList();
        }
        return patchManager.listDrafts();
    }

    @Override
    public String deletePatch(String filename) {
        if (!config.getDebug().isPatchManagement()) {
            return "Patch management is disabled via debug config";
        }
        try {
            patchManager.deletePatch(filename);
            LOGGER.atInfo().log("Deleted patch: %s", filename);
            return null; // Success
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to delete patch %s: %s", filename, e.getMessage());
            return e.getMessage();
        }
    }

    @Override
    public List<String> listPublishedPatches() {
        if (!config.getDebug().isPatchManagement()) {
            return Collections.emptyList();
        }
        return patchManager.listPublishedPatches();
    }

    @Override
    public List<PatchManager.PatchInfo> listPublishedPatchesWithContent() {
        if (!config.getDebug().isPatchManagement()) {
            return Collections.emptyList();
        }
        return patchManager.listPublishedPatchesWithContent();
    }

    @Override
    public List<PatchManager.ExternalPatchInfo> listAllPatchesAcrossMods() {
        if (!config.getDebug().isPatchManagement()) {
            return Collections.emptyList();
        }
        return patchManager.listAllPatchesAcrossMods();
    }

    @Override
    public List<HistoryEntry> getSessionHistory() {
        return historyTracker.getHistory();
    }

    /**
     * Extract BaseAssetPath from patch JSON.
     */
    private String extractBaseAssetPath(String patchJson) {
        try {
            var obj = com.google.gson.JsonParser.parseString(patchJson).getAsJsonObject();
            return obj.has("BaseAssetPath") ? obj.get("BaseAssetPath").getAsString() : "unknown";
        } catch (Exception e) {
            return "unknown";
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SERVICE GETTERS
    // ═══════════════════════════════════════════════════════════════

    public AssetCollector getAssetCollector() {
        return assetCollector;
    }

    public HytalorDetector getHytalorDetector() {
        return hytalorDetector;
    }

    public PatchManager getPatchManager() {
        return patchManager;
    }

    public SessionHistoryTracker getHistoryTracker() {
        return historyTracker;
    }

    public EntityQueryService getEntityQueryService() {
        return entityQueryService;
    }

    // ═══════════════════════════════════════════════════════════════
    // LIVE ENTITY QUERY IMPLEMENTATION
    // ═══════════════════════════════════════════════════════════════

    @Override
    public List<EntitySummary> onRequestEntityList(String filter, String search, int limit, int offset) {
        return entityQueryService.listEntities(filter, search, limit, offset);
    }

    @Override
    public int getEntityCount(String filter) {
        // Count all entities matching the filter
        String normalizedFilter = filter != null ? filter.toLowerCase() : "npc";
        if ("all".equals(normalizedFilter)) {
            return cache.getEntityCount();
        }

        return (int) cache.getAllEntities().stream()
            .filter(e -> {
                String type = e.getEntityType();
                if (type == null) return false;
                return switch (normalizedFilter) {
                    case "npc" -> "NPC".equalsIgnoreCase(type);
                    case "player" -> "PLAYER".equalsIgnoreCase(type);
                    case "item" -> "ITEM".equalsIgnoreCase(type);
                    default -> true;
                };
            })
            .count();
    }

    @Override
    public EntitySnapshot onRequestEntityDetail(long entityId) {
        refreshEntity(entityId);
        return entityQueryService.getEntityDetail(entityId);
    }

    @Override
    public List<TimerInfo> onRequestEntityTimers(long entityId) {
        if (!config.getDebug().isTimerInspection()) {
            return Collections.emptyList();
        }
        refreshEntity(entityId);
        return entityQueryService.getTimers(entityId);
    }

    @Override
    public Map<String, AlarmInfo> onRequestEntityAlarms(long entityId) {
        if (!config.getDebug().isAlarmInspection()) {
            return Collections.emptyMap();
        }
        refreshEntity(entityId);
        return entityQueryService.getAlarms(entityId);
    }

    @Override
    public List<EntitySummary> onRequestFindByTimer(String state, int limit) {
        return entityQueryService.findByTimerState(state, limit);
    }

    @Override
    public List<EntitySummary> onRequestFindByAlarm(String alarmName, String state, int limit) {
        return entityQueryService.findByAlarm(alarmName, state, limit);
    }

    // ═══════════════════════════════════════════════════════════════
    // NPC INSTRUCTION INSPECTION IMPLEMENTATION
    // ═══════════════════════════════════════════════════════════════

    @Override
    public com.laits.inspector.data.InstructionData.InstructionTreeData onRequestEntityInstructions(long entityId) {
        if (!config.getDebug().isInstructionInspection()) {
            return null;
        }
        refreshEntity(entityId);
        return entityQueryService.getInstructions(entityId);
    }

    // ═══════════════════════════════════════════════════════════════
    // ENTITY ACTIONS IMPLEMENTATION
    // ═══════════════════════════════════════════════════════════════

    @Override
    public String setEntitySurname(long entityId, String surname) {
        if (!config.getDebug().isEntityActions()) {
            return "Entity actions are disabled via debug config";
        }
        World world = currentWorld;
        if (world == null) {
            return "No world available";
        }

        // Get entity from cache to verify it exists
        EntitySnapshot cached = cache.getEntitySnapshot(entityId);
        if (cached == null) {
            return "Entity not found in cache: " + entityId;
        }

        // Get UUID for more reliable lookup
        final String targetUuid = cached.getUuid();
        LOGGER.atInfo().log("Scheduling surname change for entity %d (UUID: %s) to: %s", entityId, targetUuid, surname);

        // Schedule execution on world thread (async)
        world.execute(() -> {
            try {
                var entityStore = world.getEntityStore();
                if (entityStore == null) {
                    LOGGER.atWarning().log("Entity store not available");
                    return;
                }

                Store<EntityStore> store = entityStore.getStore();
                if (store == null) {
                    LOGGER.atWarning().log("Store not available");
                    return;
                }

                // Find entity by UUID (more reliable than index)
                final com.hypixel.hytale.component.Ref<EntityStore>[] foundRef = new com.hypixel.hytale.component.Ref[1];
                var uuidType = com.hypixel.hytale.server.core.entity.UUIDComponent.getComponentType();

                store.forEachChunk((chunk, buffer) -> {
                    if (foundRef[0] != null) return; // Already found
                    for (int i = 0; i < chunk.size(); i++) {
                        var ref = chunk.getReferenceTo(i);
                        if (ref == null) continue;

                        var uuidComp = chunk.getComponent(i, uuidType);
                        if (uuidComp != null && uuidComp.getUuid() != null) {
                            if (uuidComp.getUuid().toString().equals(targetUuid)) {
                                foundRef[0] = ref;
                                return;
                            }
                        }
                    }
                });

                if (foundRef[0] == null) {
                    LOGGER.atWarning().log("Entity not found in world by UUID: %s (id: %d)", targetUuid, entityId);
                    return;
                }

                // Store surname in LaitInspectorComponent for persistence
                var inspectorType = com.laits.inspector.component.LaitInspectorComponent.getComponentType();
                if (inspectorType != null) {
                    var inspector = store.ensureAndGetComponent(foundRef[0], inspectorType);
                    if (inspector != null) {
                        inspector.setSurname(surname);
                        LOGGER.atInfo().log("Stored surname in LaitInspectorComponent for entity %d", entityId);
                    }
                }

                // Also set Nameplate for in-game display
                var nameplateType = com.hypixel.hytale.server.core.entity.nameplate.Nameplate.getComponentType();
                var nameplate = store.ensureAndGetComponent(foundRef[0], nameplateType);
                if (nameplate != null) {
                    nameplate.setText(surname);
                }

                LOGGER.atInfo().log("Successfully set surname for entity %d to: %s", entityId, surname);

            } catch (Exception e) {
                LOGGER.atWarning().log("Failed to set surname for entity %d: %s", entityId, e.getMessage());
            }
        });

        return null; // Return success (operation scheduled)
    }

    @Override
    public String teleportToEntity(long entityId) {
        if (!config.getDebug().isEntityActions()) {
            return "Entity actions are disabled via debug config";
        }
        World world = currentWorld;
        if (world == null) {
            LOGGER.atWarning().log("Teleport failed: No world available");
            return "No world available";
        }

        // Get entity position from cache
        EntitySnapshot cached = cache.getEntitySnapshot(entityId);
        if (cached == null) {
            LOGGER.atWarning().log("Teleport failed: Entity %d not found in cache", entityId);
            return "Entity not found: " + entityId;
        }

        final double targetX = cached.getX();
        final double targetY = cached.getY();
        final double targetZ = cached.getZ();

        LOGGER.atInfo().log("Teleporting to entity %d at %.2f, %.2f, %.2f", entityId, targetX, targetY, targetZ);

        try {
            // Execute on world thread
            world.execute(() -> {
                try {
                    var players = world.getPlayers();
                    LOGGER.atInfo().log("Found %d players in world", players.size());

                    if (players.isEmpty()) {
                        LOGGER.atWarning().log("No players found in world to teleport");
                        return;
                    }

                    for (var player : players) {
                        if (player == null) {
                            LOGGER.atWarning().log("Null player in players list");
                            continue;
                        }

                        var ref = player.getReference();
                        if (ref == null) {
                            LOGGER.atWarning().log("Player %s has no reference", player.getDisplayName());
                            continue;
                        }

                        var store = ref.getStore();
                        if (store == null) {
                            LOGGER.atWarning().log("Player %s reference has no store", player.getDisplayName());
                            continue;
                        }

                        // Create teleport component using the proper API
                        var targetPos = new com.hypixel.hytale.math.vector.Vector3d(targetX, targetY, targetZ);
                        var targetRot = new com.hypixel.hytale.math.vector.Vector3f(0, 0, 0);
                        var teleport = com.hypixel.hytale.server.core.modules.entity.teleport.Teleport.createForPlayer(world, targetPos, targetRot);

                        // Add the teleport component to the player
                        store.addComponent(ref, com.hypixel.hytale.server.core.modules.entity.teleport.Teleport.getComponentType(), teleport);

                        LOGGER.atInfo().log("Teleported player %s to %.2f, %.2f, %.2f using Teleport component",
                            player.getDisplayName(), targetX, targetY, targetZ);
                    }
                } catch (Exception e) {
                    LOGGER.atWarning().log("Exception during teleport: %s", e.getMessage());
                    e.printStackTrace();
                }
            });

            return null; // Success (scheduled)
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to schedule teleport: %s", e.getMessage());
            return "Failed to teleport: " + e.getMessage();
        }
    }
}
