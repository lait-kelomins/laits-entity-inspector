package com.laits.inspector.data.asset;

import java.time.Instant;

/**
 * Represents a saved patch draft.
 */
public class PatchDraft {
    private final String filename;
    private final String baseAssetPath;
    private final String content;
    private final Instant createdAt;

    public PatchDraft(String filename, String baseAssetPath, String content, Instant createdAt) {
        this.filename = filename;
        this.baseAssetPath = baseAssetPath;
        this.content = content;
        this.createdAt = createdAt;
    }

    public String getFilename() {
        return filename;
    }

    public String getBaseAssetPath() {
        return baseAssetPath;
    }

    public String getContent() {
        return content;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    /**
     * Builder for creating PatchDraft instances.
     */
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String filename;
        private String baseAssetPath;
        private String content;
        private Instant createdAt;

        public Builder filename(String filename) {
            this.filename = filename;
            return this;
        }

        public Builder baseAssetPath(String baseAssetPath) {
            this.baseAssetPath = baseAssetPath;
            return this;
        }

        public Builder content(String content) {
            this.content = content;
            return this;
        }

        public Builder createdAt(Instant createdAt) {
            this.createdAt = createdAt;
            return this;
        }

        public PatchDraft build() {
            return new PatchDraft(filename, baseAssetPath, content, createdAt);
        }
    }
}
