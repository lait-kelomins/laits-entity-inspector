package com.laits.inspector.protocol;

/**
 * WebSocket message types for the inspector protocol.
 */
public enum MessageType {
    // Server → Client messages
    INIT,           // Initial world snapshot on connect
    ENTITY_SPAWN,   // New entity spawned
    ENTITY_DESPAWN, // Entity removed
    ENTITY_UPDATE,  // Entity component changed
    POSITION_BATCH, // Batched position updates
    PACKET_LOG,     // Network packet captured
    CONFIG_SYNC,    // Current configuration state

    // Client → Server messages (for interactive transports)
    REQUEST_SNAPSHOT,  // Request full world snapshot
    REQUEST_ENTITY,    // Request single entity details
    REQUEST_EXPAND,    // Request expanded field data (lazy loading)
    REQUEST_PACKET_EXPAND,  // Request expanded packet field data
    CONFIG_UPDATE,     // Update configuration
    SET_PAUSED,        // Pause/resume inspector updates

    // Response messages
    EXPAND_RESPONSE,   // Expanded field data response
    PACKET_EXPAND_RESPONSE,  // Expanded packet field data response

    // Control messages
    ERROR,          // Error response
    PONG,           // Response to ping

    // ═══════════════════════════════════════════════════════════════
    // ASSET BROWSER (Client → Server)
    // ═══════════════════════════════════════════════════════════════
    REQUEST_ASSET_CATEGORIES,  // Request list of asset categories
    REQUEST_ASSETS,            // Request assets in a category
    REQUEST_ASSET_DETAIL,      // Request full asset JSON
    REQUEST_ASSET_EXPAND,      // Request expanded field in asset
    REQUEST_SEARCH_ASSETS,     // Global search across all assets

    // ═══════════════════════════════════════════════════════════════
    // ASSET BROWSER (Server → Client)
    // ═══════════════════════════════════════════════════════════════
    ASSET_CATEGORIES,          // List of asset categories
    ASSET_LIST,                // List of assets in a category
    ASSET_DETAIL,              // Full asset JSON
    ASSET_EXPAND_RESPONSE,     // Expanded asset field data
    SEARCH_RESULTS,            // Global search results

    // ═══════════════════════════════════════════════════════════════
    // HYTALOR PATCHING (Client → Server)
    // ═══════════════════════════════════════════════════════════════
    REQUEST_TEST_WILDCARD,     // Test which assets match wildcard path
    REQUEST_GENERATE_PATCH,    // Generate patch from diff
    REQUEST_SAVE_DRAFT,        // Save patch draft
    REQUEST_PUBLISH_PATCH,     // Publish patch to Server/Patch/
    REQUEST_LIST_DRAFTS,       // List saved drafts

    // ═══════════════════════════════════════════════════════════════
    // HYTALOR PATCHING (Server → Client)
    // ═══════════════════════════════════════════════════════════════
    WILDCARD_MATCHES,          // Assets matching wildcard
    PATCH_GENERATED,           // Generated patch JSON
    DRAFT_SAVED,               // Draft save confirmation
    PATCH_PUBLISHED,           // Patch publish confirmation
    DRAFTS_LIST,               // List of saved drafts

    // ═══════════════════════════════════════════════════════════════
    // FEATURE DETECTION (Server → Client)
    // ═══════════════════════════════════════════════════════════════
    FEATURE_INFO               // Feature flags (hytalorEnabled, etc.)
}
