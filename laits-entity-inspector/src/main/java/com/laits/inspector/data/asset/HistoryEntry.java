package com.laits.inspector.data.asset;

import java.time.Instant;

/**
 * Represents an entry in the session patch history.
 */
public class HistoryEntry {
    private final String filename;
    private final String baseAssetPath;
    private final Instant timestamp;
    private final String operation;

    public HistoryEntry(String filename, String baseAssetPath, Instant timestamp, String operation) {
        this.filename = filename;
        this.baseAssetPath = baseAssetPath;
        this.timestamp = timestamp;
        this.operation = operation;
    }

    public String getFilename() {
        return filename;
    }

    public String getBaseAssetPath() {
        return baseAssetPath;
    }

    public Instant getTimestamp() {
        return timestamp;
    }

    public String getOperation() {
        return operation;
    }

    /**
     * Builder for creating HistoryEntry instances.
     */
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String filename;
        private String baseAssetPath;
        private Instant timestamp;
        private String operation;

        public Builder filename(String filename) {
            this.filename = filename;
            return this;
        }

        public Builder baseAssetPath(String baseAssetPath) {
            this.baseAssetPath = baseAssetPath;
            return this;
        }

        public Builder timestamp(Instant timestamp) {
            this.timestamp = timestamp;
            return this;
        }

        public Builder operation(String operation) {
            this.operation = operation;
            return this;
        }

        public HistoryEntry build() {
            return new HistoryEntry(filename, baseAssetPath, timestamp, operation);
        }
    }
}
