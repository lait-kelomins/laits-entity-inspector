package com.laits.inspector.data;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Immutable snapshot of a single entity's state at a point in time.
 * Thread-safe and serializable to JSON.
 */
public final class EntitySnapshot {
    private final long entityId;
    private final String uuid;
    private final String modelAssetId;
    private final String entityType;
    private final double x;
    private final double y;
    private final double z;
    private final float yaw;
    private final float pitch;
    private final Map<String, ComponentData> components;
    private final long timestamp;

    private EntitySnapshot(Builder builder) {
        this.entityId = builder.entityId;
        this.uuid = builder.uuid;
        this.modelAssetId = builder.modelAssetId;
        this.entityType = builder.entityType;
        this.x = builder.x;
        this.y = builder.y;
        this.z = builder.z;
        this.yaw = builder.yaw;
        this.pitch = builder.pitch;
        this.components = builder.components != null
                ? Collections.unmodifiableMap(new LinkedHashMap<>(builder.components))
                : Collections.emptyMap();
        this.timestamp = builder.timestamp > 0 ? builder.timestamp : System.currentTimeMillis();
    }

    public long getEntityId() {
        return entityId;
    }

    public String getUuid() {
        return uuid;
    }

    public String getModelAssetId() {
        return modelAssetId;
    }

    public String getEntityType() {
        return entityType;
    }

    public double getX() {
        return x;
    }

    public double getY() {
        return y;
    }

    public double getZ() {
        return z;
    }

    public float getYaw() {
        return yaw;
    }

    public float getPitch() {
        return pitch;
    }

    public Map<String, ComponentData> getComponents() {
        return components;
    }

    public ComponentData getComponent(String name) {
        return components.get(name);
    }

    public long getTimestamp() {
        return timestamp;
    }

    /**
     * Create a PositionUpdate from this snapshot.
     */
    public PositionUpdate toPositionUpdate() {
        return new PositionUpdate(entityId, uuid, x, y, z, yaw, pitch);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        EntitySnapshot that = (EntitySnapshot) o;
        return entityId == that.entityId &&
               Double.compare(that.x, x) == 0 &&
               Double.compare(that.y, y) == 0 &&
               Double.compare(that.z, z) == 0 &&
               Float.compare(that.yaw, yaw) == 0 &&
               Float.compare(that.pitch, pitch) == 0 &&
               Objects.equals(uuid, that.uuid) &&
               Objects.equals(modelAssetId, that.modelAssetId) &&
               Objects.equals(entityType, that.entityType) &&
               Objects.equals(components, that.components);
    }

    @Override
    public int hashCode() {
        return Objects.hash(entityId, uuid, modelAssetId, entityType, x, y, z, yaw, pitch, components);
    }

    @Override
    public String toString() {
        return String.format("EntitySnapshot{id=%d, model=%s, type=%s, pos=(%.2f, %.2f, %.2f), components=%d}",
                entityId, modelAssetId, entityType, x, y, z, components.size());
    }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private long entityId;
        private String uuid;
        private String modelAssetId;
        private String entityType;
        private double x, y, z;
        private float yaw, pitch;
        private Map<String, ComponentData> components = new LinkedHashMap<>();
        private long timestamp;

        public Builder entityId(long entityId) {
            this.entityId = entityId;
            return this;
        }

        public Builder uuid(String uuid) {
            this.uuid = uuid;
            return this;
        }

        public Builder modelAssetId(String modelAssetId) {
            this.modelAssetId = modelAssetId;
            return this;
        }

        public Builder entityType(String entityType) {
            this.entityType = entityType;
            return this;
        }

        public Builder position(double x, double y, double z) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }

        public Builder rotation(float yaw, float pitch) {
            this.yaw = yaw;
            this.pitch = pitch;
            return this;
        }

        public Builder addComponent(String name, ComponentData data) {
            this.components.put(name, data);
            return this;
        }

        public Builder components(Map<String, ComponentData> components) {
            this.components = new LinkedHashMap<>(components);
            return this;
        }

        public Builder timestamp(long timestamp) {
            this.timestamp = timestamp;
            return this;
        }

        public EntitySnapshot build() {
            return new EntitySnapshot(this);
        }
    }
}
