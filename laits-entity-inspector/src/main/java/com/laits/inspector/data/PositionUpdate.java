package com.laits.inspector.data;

import java.util.Objects;

/**
 * Lightweight position update for batched position broadcasts.
 * Used when only position changed, avoiding full entity snapshot overhead.
 */
public final class PositionUpdate {
    private final long entityId;
    private final String uuid;
    private final double x;
    private final double y;
    private final double z;
    private final float yaw;
    private final float pitch;

    public PositionUpdate(long entityId, String uuid, double x, double y, double z, float yaw, float pitch) {
        this.entityId = entityId;
        this.uuid = uuid;
        this.x = x;
        this.y = y;
        this.z = z;
        this.yaw = yaw;
        this.pitch = pitch;
    }

    public long getEntityId() {
        return entityId;
    }

    public String getUuid() {
        return uuid;
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

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        PositionUpdate that = (PositionUpdate) o;
        return entityId == that.entityId &&
               Double.compare(that.x, x) == 0 &&
               Double.compare(that.y, y) == 0 &&
               Double.compare(that.z, z) == 0 &&
               Float.compare(that.yaw, yaw) == 0 &&
               Float.compare(that.pitch, pitch) == 0;
    }

    @Override
    public int hashCode() {
        return Objects.hash(entityId, x, y, z, yaw, pitch);
    }

    @Override
    public String toString() {
        return String.format("PositionUpdate{entityId=%d, pos=(%.2f, %.2f, %.2f), rot=(%.1f, %.1f)}",
                entityId, x, y, z, yaw, pitch);
    }
}
