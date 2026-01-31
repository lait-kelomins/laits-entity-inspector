package com.laits.inspector.transport;

import com.laits.inspector.config.InspectorConfig;
import com.laits.inspector.data.EntitySnapshot;
import com.laits.inspector.data.PacketLogEntry;
import com.laits.inspector.data.PositionUpdate;
import com.laits.inspector.data.WorldSnapshot;

import java.util.List;

/**
 * Interface for pluggable data transports.
 * Implementations handle sending inspector data to external consumers.
 */
public interface DataTransport {

    /**
     * Start the transport with the given configuration.
     *
     * @param config Inspector configuration
     * @throws Exception if transport fails to start
     */
    void start(InspectorConfig config) throws Exception;

    /**
     * Stop the transport and clean up resources.
     */
    void stop();

    /**
     * Check if the transport is currently running.
     */
    boolean isRunning();

    /**
     * Get the number of connected clients (if applicable).
     */
    default int getClientCount() {
        return 0;
    }

    // Data output methods

    /**
     * Send a full world snapshot to all clients.
     * Used for initial connection or full refresh.
     */
    void sendWorldSnapshot(WorldSnapshot snapshot);

    /**
     * Send notification that an entity has spawned.
     */
    void sendEntitySpawn(EntitySnapshot entity);

    /**
     * Send notification that an entity has despawned.
     */
    void sendEntityDespawn(long entityId, String uuid);

    /**
     * Send notification that an entity's components have changed.
     */
    void sendEntityUpdate(EntitySnapshot entity);

    /**
     * Send notification that an entity's components have changed, with list of changed component names.
     */
    default void sendEntityUpdate(EntitySnapshot entity, java.util.List<String> changedComponents) {
        // Default implementation ignores changedComponents for backward compatibility
        sendEntityUpdate(entity);
    }

    /**
     * Send a batch of position updates.
     * Used for efficient position-only updates.
     */
    void sendPositionBatch(List<PositionUpdate> positions);

    /**
     * Send a packet log entry.
     * Used for network packet debugging.
     */
    default void sendPacketLog(PacketLogEntry entry) {
        // Optional - not all transports need packet logging
    }

    /**
     * Send current configuration to all clients.
     * Used for settings synchronization.
     */
    default void sendConfigSync(InspectorConfig config) {
        // Optional - not all transports support config sync
    }

    /**
     * Send game time sync to all clients.
     * Used to keep client time interpolation accurate when game time rate changes.
     */
    default void sendTimeSync(Long gameTimeEpochMilli, Double gameTimeRate) {
        // Optional - not all transports need time sync
    }

    // Listener for request/response transports

    /**
     * Set a listener for handling client requests.
     * Only used by interactive transports (WebSocket, HTTP).
     */
    default void setListener(DataTransportListener listener) {
        // Optional - not all transports need this
    }

    /**
     * Broadcast a raw JSON message to all connected clients.
     * Used for messages that don't fit the standard send methods.
     */
    default void broadcast(String jsonMessage) {
        // Optional - not all transports support raw broadcast
    }
}
