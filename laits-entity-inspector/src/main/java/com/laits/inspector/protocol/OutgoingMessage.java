package com.laits.inspector.protocol;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.laits.inspector.data.EntitySnapshot;
import com.laits.inspector.data.PositionUpdate;
import com.laits.inspector.data.WorldSnapshot;

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

    // Inner data classes for specific message types

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
}
