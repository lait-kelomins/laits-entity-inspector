package com.laits.inspector.protocol;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.laits.inspector.config.InspectorConfig;
import com.laits.inspector.data.EntitySnapshot;
import com.laits.inspector.data.PacketLogEntry;
import com.laits.inspector.data.PositionUpdate;
import com.laits.inspector.data.WorldSnapshot;
import com.laits.inspector.data.asset.*;

import java.util.List;

/**
 * Wrapper for outgoing WebSocket messages.
 * Provides factory methods for creating protocol-compliant messages.
 */
public class OutgoingMessage {
    private static final Gson GSON = new GsonBuilder().create();

    private final MessageType type;
    private final Object data;
    private final long timestamp;

    private OutgoingMessage(MessageType type, Object data) {
        this.type = type;
        this.data = data;
        this.timestamp = System.currentTimeMillis();
    }

    public MessageType getType() {
        return type;
    }

    public Object getData() {
        return data;
    }

    public long getTimestamp() {
        return timestamp;
    }

    /**
     * Serialize message to JSON string.
     */
    public String toJson() {
        return GSON.toJson(this);
    }

    // Factory methods

    /**
     * Create INIT message with full world snapshot.
     */
    public static OutgoingMessage init(WorldSnapshot snapshot) {
        return new OutgoingMessage(MessageType.INIT, snapshot);
    }

    /**
     * Create ENTITY_SPAWN message for a new entity.
     */
    public static OutgoingMessage entitySpawn(EntitySnapshot entity) {
        return new OutgoingMessage(MessageType.ENTITY_SPAWN, entity);
    }

    /**
     * Create ENTITY_DESPAWN message for a removed entity.
     */
    public static OutgoingMessage entityDespawn(long entityId, String uuid) {
        return new OutgoingMessage(MessageType.ENTITY_DESPAWN, new DespawnData(entityId, uuid));
    }

    /**
     * Create ENTITY_UPDATE message for component changes.
     */
    public static OutgoingMessage entityUpdate(EntitySnapshot entity) {
        return new OutgoingMessage(MessageType.ENTITY_UPDATE, entity);
    }

    /**
     * Create ENTITY_UPDATE message with changed components list.
     */
    public static OutgoingMessage entityUpdate(EntitySnapshot entity, List<String> changedComponents) {
        return new OutgoingMessage(MessageType.ENTITY_UPDATE, new EntityUpdateData(entity, changedComponents));
    }

    /**
     * Create POSITION_BATCH message for position-only updates.
     */
    public static OutgoingMessage positionBatch(List<PositionUpdate> positions) {
        return new OutgoingMessage(MessageType.POSITION_BATCH, positions);
    }

    /**
     * Create ERROR message.
     */
    public static OutgoingMessage error(String message) {
        return new OutgoingMessage(MessageType.ERROR, new ErrorData(message));
    }

    /**
     * Create PONG response.
     */
    public static OutgoingMessage pong() {
        return new OutgoingMessage(MessageType.PONG, null);
    }

    /**
     * Create PACKET_LOG message for network packet capture.
     */
    public static OutgoingMessage packetLog(PacketLogEntry entry) {
        return new OutgoingMessage(MessageType.PACKET_LOG, entry);
    }

    /**
     * Create CONFIG_SYNC message with current configuration.
     */
    public static OutgoingMessage configSync(InspectorConfig config) {
        return new OutgoingMessage(MessageType.CONFIG_SYNC, new ConfigData(config));
    }

    /**
     * Create EXPAND_RESPONSE message with expanded field data.
     */
    public static OutgoingMessage expandResponse(long entityId, String path, Object expandedData) {
        return new OutgoingMessage(MessageType.EXPAND_RESPONSE, new ExpandData(entityId, path, expandedData));
    }

    /**
     * Create PACKET_EXPAND_RESPONSE message with expanded packet field data.
     */
    public static OutgoingMessage packetExpandResponse(long packetId, String path, Object expandedData) {
        return new OutgoingMessage(MessageType.PACKET_EXPAND_RESPONSE, new PacketExpandData(packetId, path, expandedData));
    }

    // ═══════════════════════════════════════════════════════════════
    // ASSET BROWSER MESSAGES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Create ASSET_CATEGORIES message with list of asset categories.
     */
    public static OutgoingMessage assetCategories(List<AssetCategory> categories) {
        return new OutgoingMessage(MessageType.ASSET_CATEGORIES, new AssetCategoriesData(categories));
    }

    /**
     * Create ASSET_LIST message with assets in a category.
     */
    public static OutgoingMessage assetList(String category, List<AssetEntry> assets) {
        return new OutgoingMessage(MessageType.ASSET_LIST, new AssetListData(category, assets));
    }

    /**
     * Create ASSET_DETAIL message with full asset JSON.
     */
    public static OutgoingMessage assetDetail(AssetDetail detail) {
        return new OutgoingMessage(MessageType.ASSET_DETAIL, detail);
    }

    /**
     * Create ASSET_EXPAND_RESPONSE message with expanded asset field.
     */
    public static OutgoingMessage assetExpandResponse(String category, String assetId, String path, Object data) {
        return new OutgoingMessage(MessageType.ASSET_EXPAND_RESPONSE, new AssetExpandData(category, assetId, path, data));
    }

    /**
     * Create SEARCH_RESULTS message with global search results.
     */
    public static OutgoingMessage searchResults(String query, List<AssetEntry> results) {
        return new OutgoingMessage(MessageType.SEARCH_RESULTS, new SearchResultsData(query, results));
    }

    // ═══════════════════════════════════════════════════════════════
    // HYTALOR PATCHING MESSAGES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Create WILDCARD_MATCHES message with matched assets.
     */
    public static OutgoingMessage wildcardMatches(String pattern, List<String> matches) {
        return new OutgoingMessage(MessageType.WILDCARD_MATCHES, new WildcardMatchesData(pattern, matches));
    }

    /**
     * Create PATCH_GENERATED message with generated patch JSON.
     */
    public static OutgoingMessage patchGenerated(String patchJson, String error) {
        return new OutgoingMessage(MessageType.PATCH_GENERATED, new PatchGeneratedData(patchJson, error));
    }

    /**
     * Create DRAFT_SAVED message confirming draft save.
     */
    public static OutgoingMessage draftSaved(String filename, boolean success, String error) {
        return new OutgoingMessage(MessageType.DRAFT_SAVED, new DraftSavedData(filename, success, error));
    }

    /**
     * Create PATCH_PUBLISHED message confirming patch publish.
     */
    public static OutgoingMessage patchPublished(String filename, boolean success, String error) {
        return new OutgoingMessage(MessageType.PATCH_PUBLISHED, new PatchPublishedData(filename, success, error));
    }

    /**
     * Create DRAFTS_LIST message with list of drafts.
     */
    public static OutgoingMessage draftsList(List<PatchDraft> drafts) {
        return new OutgoingMessage(MessageType.DRAFTS_LIST, new DraftsListData(drafts));
    }

    // ═══════════════════════════════════════════════════════════════
    // FEATURE DETECTION MESSAGES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Create FEATURE_INFO message with feature flags.
     */
    public static OutgoingMessage featureInfo(FeatureInfo info) {
        return new OutgoingMessage(MessageType.FEATURE_INFO, info);
    }

    // Inner data classes for specific message types

    /**
     * Configuration data for frontend sync.
     */
    public static class ConfigData {
        // General settings
        public final boolean enabled;
        public final int updateIntervalTicks;
        public final boolean includeNPCs;
        public final boolean includePlayers;
        public final boolean includeItems;
        public final int maxCachedEntities;

        // WebSocket settings
        public final boolean websocketEnabled;
        public final int websocketPort;
        public final String websocketBindAddress;
        public final int websocketMaxClients;

        // Packet log settings
        public final boolean packetLogEnabled;
        public final List<String> packetLogExcluded;

        ConfigData(InspectorConfig config) {
            this.enabled = config.isEnabled();
            this.updateIntervalTicks = config.getUpdateIntervalTicks();
            this.includeNPCs = config.isIncludeNPCs();
            this.includePlayers = config.isIncludePlayers();
            this.includeItems = config.isIncludeItems();
            this.maxCachedEntities = config.getMaxCachedEntities();

            var ws = config.getWebsocket();
            this.websocketEnabled = ws.isEnabled();
            this.websocketPort = ws.getPort();
            this.websocketBindAddress = ws.getBindAddress();
            this.websocketMaxClients = ws.getMaxClients();

            var pl = config.getPacketLog();
            this.packetLogEnabled = pl.isEnabled();
            this.packetLogExcluded = pl.getExcludedPackets();
        }
    }

    private static class DespawnData {
        private final long entityId;
        private final String uuid;

        DespawnData(long entityId, String uuid) {
            this.entityId = entityId;
            this.uuid = uuid;
        }
    }

    private static class ErrorData {
        private final String message;

        ErrorData(String message) {
            this.message = message;
        }
    }

    /**
     * Wrapper for entity update with changed components list.
     */
    private static class EntityUpdateData {
        private final long entityId;
        private final String uuid;
        private final String modelAssetId;
        private final String entityType;
        private final double x;
        private final double y;
        private final double z;
        private final float yaw;
        private final float pitch;
        private final Object components;
        private final long timestamp;
        private final List<String> changedComponents;

        EntityUpdateData(EntitySnapshot entity, List<String> changedComponents) {
            this.entityId = entity.getEntityId();
            this.uuid = entity.getUuid();
            this.modelAssetId = entity.getModelAssetId();
            this.entityType = entity.getEntityType();
            this.x = entity.getX();
            this.y = entity.getY();
            this.z = entity.getZ();
            this.yaw = entity.getYaw();
            this.pitch = entity.getPitch();
            this.components = entity.getComponents();
            this.timestamp = entity.getTimestamp();
            this.changedComponents = changedComponents;
        }
    }

    /**
     * Data for expand response - contains the expanded field data.
     */
    private static class ExpandData {
        private final long entityId;
        private final String path;
        private final Object data;

        ExpandData(long entityId, String path, Object data) {
            this.entityId = entityId;
            this.path = path;
            this.data = data;
        }
    }

    /**
     * Data for packet expand response - contains the expanded packet field data.
     */
    private static class PacketExpandData {
        private final long packetId;
        private final String path;
        private final Object data;

        PacketExpandData(long packetId, String path, Object data) {
            this.packetId = packetId;
            this.path = path;
            this.data = data;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // ASSET BROWSER DATA CLASSES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Data for asset categories response.
     */
    private static class AssetCategoriesData {
        private final List<AssetCategory> categories;

        AssetCategoriesData(List<AssetCategory> categories) {
            this.categories = categories;
        }
    }

    /**
     * Data for asset list response.
     */
    private static class AssetListData {
        private final String category;
        private final List<AssetEntry> assets;

        AssetListData(String category, List<AssetEntry> assets) {
            this.category = category;
            this.assets = assets;
        }
    }

    /**
     * Data for asset expand response.
     */
    private static class AssetExpandData {
        private final String category;
        private final String assetId;
        private final String path;
        private final Object data;

        AssetExpandData(String category, String assetId, String path, Object data) {
            this.category = category;
            this.assetId = assetId;
            this.path = path;
            this.data = data;
        }
    }

    /**
     * Data for search results response.
     */
    private static class SearchResultsData {
        private final String query;
        private final List<AssetEntry> results;

        SearchResultsData(String query, List<AssetEntry> results) {
            this.query = query;
            this.results = results;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // HYTALOR PATCHING DATA CLASSES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Data for wildcard matches response.
     */
    private static class WildcardMatchesData {
        private final String pattern;
        private final List<String> matches;

        WildcardMatchesData(String pattern, List<String> matches) {
            this.pattern = pattern;
            this.matches = matches;
        }
    }

    /**
     * Data for patch generated response.
     */
    private static class PatchGeneratedData {
        private final String patchJson;
        private final String error;

        PatchGeneratedData(String patchJson, String error) {
            this.patchJson = patchJson;
            this.error = error;
        }
    }

    /**
     * Data for draft saved response.
     */
    private static class DraftSavedData {
        private final String filename;
        private final boolean success;
        private final String error;

        DraftSavedData(String filename, boolean success, String error) {
            this.filename = filename;
            this.success = success;
            this.error = error;
        }
    }

    /**
     * Data for patch published response.
     */
    private static class PatchPublishedData {
        private final String filename;
        private final boolean success;
        private final String error;

        PatchPublishedData(String filename, boolean success, String error) {
            this.filename = filename;
            this.success = success;
            this.error = error;
        }
    }

    /**
     * Data for drafts list response.
     */
    private static class DraftsListData {
        private final List<PatchDraft> drafts;

        DraftsListData(List<PatchDraft> drafts) {
            this.drafts = drafts;
        }
    }
}
