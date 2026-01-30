package com.laits.inspector.data;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

/**
 * Immutable snapshot of an entire world's entity state.
 * Used for initial client connection or full refresh requests.
 */
public final class WorldSnapshot {
    private final String worldId;
    private final String worldName;
    private final List<EntitySnapshot> entities;
    private final long timestamp;
    private final int totalEntities;
    private final Long gameTimeEpochMilli;
    private final Double gameTimeRate;  // Game seconds per real second (e.g., 72 = 72x speed)

    private WorldSnapshot(Builder builder) {
        this.worldId = builder.worldId;
        this.worldName = builder.worldName;
        this.entities = builder.entities != null
                ? Collections.unmodifiableList(new ArrayList<>(builder.entities))
                : Collections.emptyList();
        this.timestamp = builder.timestamp > 0 ? builder.timestamp : System.currentTimeMillis();
        this.totalEntities = this.entities.size();
        this.gameTimeEpochMilli = builder.gameTimeEpochMilli;
        this.gameTimeRate = builder.gameTimeRate;
    }

    public String getWorldId() {
        return worldId;
    }

    public String getWorldName() {
        return worldName;
    }

    public List<EntitySnapshot> getEntities() {
        return entities;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public int getTotalEntities() {
        return totalEntities;
    }

    public Long getGameTimeEpochMilli() {
        return gameTimeEpochMilli;
    }

    public Double getGameTimeRate() {
        return gameTimeRate;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        WorldSnapshot that = (WorldSnapshot) o;
        return timestamp == that.timestamp &&
               Objects.equals(worldId, that.worldId) &&
               Objects.equals(worldName, that.worldName) &&
               Objects.equals(entities, that.entities);
    }

    @Override
    public int hashCode() {
        return Objects.hash(worldId, worldName, entities, timestamp);
    }

    @Override
    public String toString() {
        return String.format("WorldSnapshot{worldId=%s, worldName=%s, entities=%d, timestamp=%d}",
                worldId, worldName, totalEntities, timestamp);
    }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String worldId;
        private String worldName;
        private List<EntitySnapshot> entities = new ArrayList<>();
        private long timestamp;
        private Long gameTimeEpochMilli;
        private Double gameTimeRate;

        public Builder worldId(String worldId) {
            this.worldId = worldId;
            return this;
        }

        public Builder worldName(String worldName) {
            this.worldName = worldName;
            return this;
        }

        public Builder addEntity(EntitySnapshot entity) {
            this.entities.add(entity);
            return this;
        }

        public Builder entities(List<EntitySnapshot> entities) {
            this.entities = new ArrayList<>(entities);
            return this;
        }

        public Builder timestamp(long timestamp) {
            this.timestamp = timestamp;
            return this;
        }

        public Builder gameTimeEpochMilli(Long gameTimeEpochMilli) {
            this.gameTimeEpochMilli = gameTimeEpochMilli;
            return this;
        }

        public Builder gameTimeRate(Double gameTimeRate) {
            this.gameTimeRate = gameTimeRate;
            return this;
        }

        public WorldSnapshot build() {
            return new WorldSnapshot(this);
        }
    }
}
