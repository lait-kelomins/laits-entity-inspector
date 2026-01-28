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

    // Client → Server messages (for interactive transports)
    REQUEST_SNAPSHOT,  // Request full world snapshot
    REQUEST_ENTITY,    // Request single entity details

    // Control messages
    ERROR,          // Error response
    PONG            // Response to ping
}
