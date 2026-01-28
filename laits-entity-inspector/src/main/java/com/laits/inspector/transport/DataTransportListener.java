package com.laits.inspector.transport;

import com.laits.inspector.data.EntitySnapshot;
import com.laits.inspector.data.WorldSnapshot;

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
}
