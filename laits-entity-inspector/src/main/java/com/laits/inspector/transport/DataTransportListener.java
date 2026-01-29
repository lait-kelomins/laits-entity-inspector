package com.laits.inspector.transport;

import com.laits.inspector.config.InspectorConfig;
import com.laits.inspector.data.EntitySnapshot;
import com.laits.inspector.data.WorldSnapshot;
import com.laits.inspector.data.asset.*;

import java.util.List;
import java.util.Map;

/**
 * Callback interface for transports that support client requests.
 * Used by interactive transports like WebSocket.
 */
public interface DataTransportListener {

    /**
     * Handle client request for a full world snapshot.
     *
     * @param worldId Optional world ID filter (null for default/all)
     * @return World snapshot, or null if not available
     */
    WorldSnapshot onRequestSnapshot(String worldId);

    /**
     * Handle client request for a single entity's details.
     *
     * @param entityId The entity ID to look up
     * @return Entity snapshot, or null if not found
     */
    EntitySnapshot onRequestEntity(long entityId);

    /**
     * Handle client request to update configuration.
     *
     * @param updates Map of config keys to new values
     * @return Updated config, or null if update failed
     */
    default InspectorConfig onConfigUpdate(Map<String, Object> updates) {
        return null;
    }

    /**
     * Get the current configuration.
     *
     * @return Current config
     */
    default InspectorConfig getConfig() {
        return null;
    }

    /**
     * Handle client request to expand a field for lazy loading.
     *
     * @param entityId The entity ID
     * @param path The field path to expand (e.g., "components.InventoryComponent.items.0")
     * @return Expanded data, or null if not found
     */
    default Object onRequestExpand(long entityId, String path) {
        return null;
    }

    /**
     * Handle client request to expand a packet field for lazy loading.
     *
     * @param packetId The packet log entry ID
     * @param path The field path to expand (e.g., "data.someField.nested")
     * @return Expanded data, or null if not found
     */
    default Object onRequestPacketExpand(long packetId, String path) {
        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    // ASSET BROWSER CALLBACKS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get feature info (Hytalor status, directories).
     */
    default FeatureInfo getFeatureInfo() {
        return null;
    }

    /**
     * Get list of asset categories.
     */
    default List<AssetCategory> getAssetCategories() {
        return null;
    }

    /**
     * Get assets in a category.
     *
     * @param category The category ID
     * @param filter Optional filter string
     */
    default List<AssetEntry> getAssets(String category, String filter) {
        return null;
    }

    /**
     * Get full asset detail.
     *
     * @param category The category ID
     * @param assetId The asset ID
     */
    default AssetDetail getAssetDetail(String category, String assetId) {
        return null;
    }

    /**
     * Search all assets globally.
     *
     * @param query The search query
     */
    default List<AssetEntry> searchAssets(String query) {
        return null;
    }

    /**
     * Expand an asset field for lazy loading.
     *
     * @param category The category ID
     * @param assetId The asset ID
     * @param path The field path to expand
     */
    default Object onRequestAssetExpand(String category, String assetId, String path) {
        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    // HYTALOR PATCHING CALLBACKS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Test which assets match a wildcard path.
     */
    default List<String> testWildcard(String wildcardPath) {
        return null;
    }

    /**
     * Generate a patch from diff.
     *
     * @param baseAssetPath The asset path
     * @param original Original JSON content
     * @param modified Modified JSON content
     * @param operation Patch operation type
     */
    default String generatePatch(String baseAssetPath, Map<String, Object> original,
                                  Map<String, Object> modified, String operation) {
        return null;
    }

    /**
     * Save a draft patch.
     *
     * @param filename The filename
     * @param patchJson The patch JSON content
     * @return Error message or null on success
     */
    default String saveDraft(String filename, String patchJson) {
        return "Not implemented";
    }

    /**
     * Publish a patch to Server/Patch/.
     *
     * @param filename The filename
     * @param patchJson The patch JSON content
     * @return Error message or null on success
     */
    default String publishPatch(String filename, String patchJson) {
        return "Not implemented";
    }

    /**
     * List saved drafts.
     */
    default List<PatchDraft> listDrafts() {
        return null;
    }

    /**
     * Get session patch history.
     */
    default List<HistoryEntry> getSessionHistory() {
        return null;
    }
}
