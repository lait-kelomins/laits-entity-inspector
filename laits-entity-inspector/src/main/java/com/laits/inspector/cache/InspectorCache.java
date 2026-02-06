package com.laits.inspector.cache;

import com.laits.inspector.data.EntitySnapshot;
import com.laits.inspector.data.PacketLogEntry;

import java.util.Collection;
import java.util.Map;

/**
 * Abstract cache interface for entity and packet data.
 * Allows swapping between in-memory and persistent (SQLite) implementations.
 */
public interface InspectorCache {

    // ═══════════════════════════════════════════════════════════════
    // ENTITY OPERATIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Store an entity snapshot with optional component references for expansion.
     *
     * @param entityId      The entity ID
     * @param snapshot      The serialized snapshot
     * @param componentRefs Map of component name -> original Java object (for lazy expansion)
     */
    void putEntity(long entityId, EntitySnapshot snapshot, Map<String, Object> componentRefs);

    /**
     * Get a cached entity snapshot.
     */
    EntitySnapshot getEntitySnapshot(long entityId);

    /**
     * Expand a path within an entity's components.
     * Returns deeply serialized data for the requested path.
     *
     * @param entityId The entity ID
     * @param path     Path like "components.NPCEntity.fields.role"
     * @return Expanded/serialized data, or null if not found
     */
    Object expandEntityPath(long entityId, String path);

    /**
     * Get a live component object reference from the cache.
     * Used for accessing live game objects (e.g., NPCEntity) beyond serialized snapshots.
     *
     * @param entityId      The entity ID
     * @param componentName The component name (e.g., "NPCEntity")
     * @return The live component object, or null if not found / GC'd
     */
    Object getLiveComponent(long entityId, String componentName);

    /**
     * Remove an entity from the cache.
     */
    void removeEntity(long entityId);

    /**
     * Get all cached entity snapshots.
     */
    Collection<EntitySnapshot> getAllEntities();

    /**
     * Get the number of cached entities.
     */
    int getEntityCount();

    // ═══════════════════════════════════════════════════════════════
    // PACKET OPERATIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Store a packet with its original object for expansion.
     *
     * @param entry          The serialized packet log entry
     * @param originalPacket The original packet object (for lazy expansion)
     */
    void putPacket(PacketLogEntry entry, Object originalPacket);

    /**
     * Expand a path within a packet's data.
     *
     * @param packetId The packet log entry ID
     * @param path     Path like "data.someField.nestedObject"
     * @return Expanded/serialized data, or null if not found
     */
    Object expandPacketPath(long packetId, String path);

    /**
     * Get the number of cached packets.
     */
    int getPacketCount();

    // ═══════════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═══════════════════════════════════════════════════════════════

    /**
     * Clear all cached data.
     */
    void clear();

    /**
     * Configure cache limits.
     */
    void setLimits(int maxEntities, int maxPackets);
}
