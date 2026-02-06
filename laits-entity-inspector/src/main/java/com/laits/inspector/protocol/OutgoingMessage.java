package com.laits.inspector.protocol;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.laits.inspector.config.InspectorConfig;
import com.laits.inspector.data.*;
import com.laits.inspector.data.asset.*;

import java.util.List;
import java.util.Map;

/**
 * Wrapper for outgoing WebSocket messages.
 * Provides factory methods for creating protocol-compliant messages.
 */
public class OutgoingMessage {
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

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
     * Create TIME_SYNC message with current game time and rate.
     */
    public static OutgoingMessage timeSync(Long gameTimeEpochMilli, Double gameTimeRate) {
        return new OutgoingMessage(MessageType.TIME_SYNC, new TimeSyncData(gameTimeEpochMilli, gameTimeRate));
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

    /**
     * Create ASSETS_REFRESHED message confirming asset refresh is complete.
     */
    public static OutgoingMessage assetsRefreshed() {
        return new OutgoingMessage(MessageType.ASSETS_REFRESHED, null);
    }

    /**
     * Create ASSETS_REFRESHED message with optional patched asset path.
     * Used after patch publish to indicate which asset was patched for auto-refresh.
     */
    public static OutgoingMessage assetsRefreshed(String patchedAssetPath) {
        if (patchedAssetPath == null) {
            return new OutgoingMessage(MessageType.ASSETS_REFRESHED, null);
        }
        return new OutgoingMessage(MessageType.ASSETS_REFRESHED,
            java.util.Map.of("patchedAssetPath", patchedAssetPath));
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

    /**
     * Create PATCH_DELETED message confirming patch deletion.
     */
    public static OutgoingMessage patchDeleted(String filename, boolean success, String error) {
        return new OutgoingMessage(MessageType.PATCH_DELETED, new PatchDeletedData(filename, success, error));
    }

    /**
     * Create PATCHES_LIST message with list of published patches (filenames only).
     */
    public static OutgoingMessage patchesList(List<String> patches) {
        return new OutgoingMessage(MessageType.PATCHES_LIST, new PatchesListData(patches, null));
    }

    /**
     * Create PATCHES_LIST message with list of published patches including content.
     */
    public static OutgoingMessage patchesListWithContent(List<com.laits.inspector.core.PatchManager.PatchInfo> patches) {
        var patchInfoList = patches.stream()
                .map(p -> new PatchInfoData(p.filename(), p.content(), p.modifiedTime()))
                .toList();
        return new OutgoingMessage(MessageType.PATCHES_LIST, new PatchesListData(null, patchInfoList));
    }

    /**
     * Create ALL_PATCHES_LIST message with patches from all mods.
     */
    public static OutgoingMessage allPatchesList(List<com.laits.inspector.core.PatchManager.ExternalPatchInfo> patches) {
        var patchInfoList = patches.stream()
                .map(p -> new ExternalPatchInfoData(
                    p.filename(),
                    p.content(),
                    p.modifiedTime(),
                    p.sourceMod(),
                    p.isEditable()
                ))
                .toList();
        return new OutgoingMessage(MessageType.ALL_PATCHES_LIST, new AllPatchesListData(patchInfoList));
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

        // Debug feature toggles
        public final DebugData debug;

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

            this.debug = new DebugData(config.getDebug());
        }
    }

    /**
     * Debug feature toggle data for frontend sync.
     */
    public static class DebugData {
        public final boolean positionTracking;
        public final boolean entityLifecycle;
        public final boolean onDemandRefresh;
        public final boolean alarmInspection;
        public final boolean timerInspection;
        public final boolean instructionInspection;
        public final boolean lazyExpansion;
        public final boolean assetBrowser;
        public final boolean patchManagement;
        public final boolean entityActions;

        DebugData(InspectorConfig.DebugConfig debug) {
            this.positionTracking = debug.isPositionTracking();
            this.entityLifecycle = debug.isEntityLifecycle();
            this.onDemandRefresh = debug.isOnDemandRefresh();
            this.alarmInspection = debug.isAlarmInspection();
            this.timerInspection = debug.isTimerInspection();
            this.instructionInspection = debug.isInstructionInspection();
            this.lazyExpansion = debug.isLazyExpansion();
            this.assetBrowser = debug.isAssetBrowser();
            this.patchManagement = debug.isPatchManagement();
            this.entityActions = debug.isEntityActions();
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
     * Data for time sync message.
     */
    private static class TimeSyncData {
        private final Long gameTimeEpochMilli;
        private final Double gameTimeRate;

        TimeSyncData(Long gameTimeEpochMilli, Double gameTimeRate) {
            this.gameTimeEpochMilli = gameTimeEpochMilli;
            this.gameTimeRate = gameTimeRate;
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

    /**
     * Data for patch deleted response.
     */
    private static class PatchDeletedData {
        private final String filename;
        private final boolean success;
        private final String error;

        PatchDeletedData(String filename, boolean success, String error) {
            this.filename = filename;
            this.success = success;
            this.error = error;
        }
    }

    /**
     * Data for patches list response.
     * Can include either just filenames (patches) or full info (patchesWithContent).
     */
    private static class PatchesListData {
        private final List<String> patches;
        private final List<PatchInfoData> patchesWithContent;

        PatchesListData(List<String> patches, List<PatchInfoData> patchesWithContent) {
            this.patches = patches;
            this.patchesWithContent = patchesWithContent;
        }
    }

    /**
     * Full patch info including content.
     */
    private static class PatchInfoData {
        private final String filename;
        private final String content;
        private final long modifiedTime;

        PatchInfoData(String filename, String content, long modifiedTime) {
            this.filename = filename;
            this.content = content;
            this.modifiedTime = modifiedTime;
        }
    }

    /**
     * External patch info including source mod and editability.
     */
    private static class ExternalPatchInfoData {
        private final String filename;
        private final String content;
        private final long modifiedTime;
        private final String sourceMod;
        private final boolean isEditable;

        ExternalPatchInfoData(String filename, String content, long modifiedTime, String sourceMod, boolean isEditable) {
            this.filename = filename;
            this.content = content;
            this.modifiedTime = modifiedTime;
            this.sourceMod = sourceMod;
            this.isEditable = isEditable;
        }
    }

    /**
     * Data for all patches list response (across all mods).
     */
    private static class AllPatchesListData {
        private final List<ExternalPatchInfoData> patches;

        AllPatchesListData(List<ExternalPatchInfoData> patches) {
            this.patches = patches;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // LIVE ENTITY QUERY MESSAGES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Create ENTITY_LIST message with list of entity summaries.
     */
    public static OutgoingMessage entityList(List<EntitySummary> entities, int total, String filter, int offset) {
        return new OutgoingMessage(MessageType.ENTITY_LIST, new EntityListData(entities, total, filter, offset));
    }

    /**
     * Create ENTITY_DETAIL message with full entity data.
     */
    public static OutgoingMessage entityDetail(EntitySnapshot entity) {
        return new OutgoingMessage(MessageType.ENTITY_DETAIL, entity);
    }

    /**
     * Create ENTITY_TIMERS message with timer state.
     */
    public static OutgoingMessage entityTimers(long entityId, List<TimerInfo> timers) {
        return new OutgoingMessage(MessageType.ENTITY_TIMERS, new EntityTimersData(entityId, timers));
    }

    /**
     * Create ENTITY_ALARMS message with alarm state.
     */
    public static OutgoingMessage entityAlarms(long entityId, Map<String, AlarmInfo> alarms) {
        return new OutgoingMessage(MessageType.ENTITY_ALARMS, new EntityAlarmsData(entityId, alarms));
    }

    /**
     * Create TIMER_SEARCH_RESULTS message with entities matching timer criteria.
     */
    public static OutgoingMessage timerSearchResults(String state, List<EntitySummary> entities) {
        return new OutgoingMessage(MessageType.TIMER_SEARCH_RESULTS, new TimerSearchData(state, entities));
    }

    /**
     * Create ALARM_SEARCH_RESULTS message with entities matching alarm criteria.
     */
    public static OutgoingMessage alarmSearchResults(String alarmName, String state, List<EntitySummary> entities) {
        return new OutgoingMessage(MessageType.ALARM_SEARCH_RESULTS, new AlarmSearchData(alarmName, state, entities));
    }

    // ═══════════════════════════════════════════════════════════════
    // LIVE ENTITY QUERY DATA CLASSES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Data for entity list response.
     */
    private static class EntityListData {
        private final List<EntitySummary> entities;
        private final int total;
        private final String filter;
        private final int offset;

        EntityListData(List<EntitySummary> entities, int total, String filter, int offset) {
            this.entities = entities;
            this.total = total;
            this.filter = filter;
            this.offset = offset;
        }
    }

    /**
     * Data for entity timers response.
     */
    private static class EntityTimersData {
        private final long entityId;
        private final List<TimerInfo> timers;

        EntityTimersData(long entityId, List<TimerInfo> timers) {
            this.entityId = entityId;
            this.timers = timers;
        }
    }

    /**
     * Data for entity alarms response.
     */
    private static class EntityAlarmsData {
        private final long entityId;
        private final Map<String, AlarmInfo> alarms;

        EntityAlarmsData(long entityId, Map<String, AlarmInfo> alarms) {
            this.entityId = entityId;
            this.alarms = alarms;
        }
    }

    /**
     * Data for timer search results response.
     */
    private static class TimerSearchData {
        private final String state;
        private final List<EntitySummary> entities;

        TimerSearchData(String state, List<EntitySummary> entities) {
            this.state = state;
            this.entities = entities;
        }
    }

    /**
     * Data for alarm search results response.
     */
    private static class AlarmSearchData {
        private final String alarmName;
        private final String state;
        private final List<EntitySummary> entities;

        AlarmSearchData(String alarmName, String state, List<EntitySummary> entities) {
            this.alarmName = alarmName;
            this.state = state;
            this.entities = entities;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // NPC INSTRUCTION INSPECTION MESSAGES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Create ENTITY_INSTRUCTIONS message with serialized instruction tree.
     */
    public static OutgoingMessage entityInstructions(long entityId,
            com.laits.inspector.data.InstructionData.InstructionTreeData tree) {
        return new OutgoingMessage(MessageType.ENTITY_INSTRUCTIONS,
            new EntityInstructionsData(entityId, tree));
    }

    // ═══════════════════════════════════════════════════════════════
    // ENTITY ACTIONS MESSAGES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Create SURNAME_SET message with result of surname change.
     */
    public static OutgoingMessage surnameSet(long entityId, String surname, boolean success, String error) {
        return new OutgoingMessage(MessageType.SURNAME_SET, new SurnameSetData(entityId, surname, success, error));
    }

    /**
     * Create TELEPORT_RESULT message with teleport outcome.
     */
    public static OutgoingMessage teleportResult(long entityId, boolean success, String error) {
        return new OutgoingMessage(MessageType.TELEPORT_RESULT, new TeleportResultData(entityId, success, error));
    }

    // ═══════════════════════════════════════════════════════════════
    // ENTITY ACTIONS DATA CLASSES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Data for surname set response.
     */
    private static class SurnameSetData {
        private final long entityId;
        private final String surname;
        private final boolean success;
        private final String error;

        SurnameSetData(long entityId, String surname, boolean success, String error) {
            this.entityId = entityId;
            this.surname = surname;
            this.success = success;
            this.error = error;
        }
    }

    /**
     * Data for teleport result response.
     */
    private static class TeleportResultData {
        private final long entityId;
        private final boolean success;
        private final String error;

        TeleportResultData(long entityId, boolean success, String error) {
            this.entityId = entityId;
            this.success = success;
            this.error = error;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // NPC INSTRUCTION INSPECTION DATA CLASSES
    // ═══════════════════════════════════════════════════════════════

    /**
     * Data for entity instructions response.
     */
    private static class EntityInstructionsData {
        private final long entityId;
        private final com.laits.inspector.data.InstructionData.InstructionTreeData instructions;

        EntityInstructionsData(long entityId,
                com.laits.inspector.data.InstructionData.InstructionTreeData instructions) {
            this.entityId = entityId;
            this.instructions = instructions;
        }
    }
}
