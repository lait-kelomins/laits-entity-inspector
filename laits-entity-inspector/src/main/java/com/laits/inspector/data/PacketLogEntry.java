package com.laits.inspector.data;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Immutable snapshot of a network packet event.
 * Captures both inbound and outbound packets for debugging.
 */
public final class PacketLogEntry {
    private static final java.util.concurrent.atomic.AtomicLong ID_GENERATOR = new java.util.concurrent.atomic.AtomicLong(0);

    private final long id;              // Unique ID for packet reference/expansion
    private final long timestamp;
    private final String direction;     // "inbound" or "outbound"
    private final String packetName;
    private final int packetId;
    private final String handlerName;
    private final Map<String, Object> data;

    private PacketLogEntry(Builder builder) {
        this.id = ID_GENERATOR.incrementAndGet();
        this.timestamp = builder.timestamp > 0 ? builder.timestamp : System.currentTimeMillis();
        this.direction = builder.direction;
        this.packetName = builder.packetName;
        this.packetId = builder.packetId;
        this.handlerName = builder.handlerName;
        this.data = builder.data != null
                ? Collections.unmodifiableMap(new LinkedHashMap<>(builder.data))
                : Collections.emptyMap();
    }

    public long getId() {
        return id;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public String getDirection() {
        return direction;
    }

    public String getPacketName() {
        return packetName;
    }

    public int getPacketId() {
        return packetId;
    }

    public String getHandlerName() {
        return handlerName;
    }

    public Map<String, Object> getData() {
        return data;
    }

    public boolean isInbound() {
        return "inbound".equals(direction);
    }

    public boolean isOutbound() {
        return "outbound".equals(direction);
    }

    @Override
    public String toString() {
        return String.format("PacketLogEntry{%s %s id=%d handler=%s fields=%d}",
                direction, packetName, packetId, handlerName, data.size());
    }

    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private long timestamp;
        private String direction;
        private String packetName;
        private int packetId;
        private String handlerName;
        private Map<String, Object> data = new LinkedHashMap<>();

        public Builder timestamp(long timestamp) {
            this.timestamp = timestamp;
            return this;
        }

        public Builder direction(String direction) {
            this.direction = direction;
            return this;
        }

        public Builder inbound() {
            this.direction = "inbound";
            return this;
        }

        public Builder outbound() {
            this.direction = "outbound";
            return this;
        }

        public Builder packetName(String packetName) {
            this.packetName = packetName;
            return this;
        }

        public Builder packetId(int packetId) {
            this.packetId = packetId;
            return this;
        }

        public Builder handlerName(String handlerName) {
            this.handlerName = handlerName;
            return this;
        }

        public Builder data(Map<String, Object> data) {
            this.data = new LinkedHashMap<>(data);
            return this;
        }

        public Builder addField(String key, Object value) {
            this.data.put(key, value);
            return this;
        }

        public PacketLogEntry build() {
            return new PacketLogEntry(this);
        }
    }
}
