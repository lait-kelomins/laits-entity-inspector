package com.laits.inspector.data.asset;

import java.util.Map;

/**
 * Represents full details of an asset including its JSON content.
 */
public class AssetDetail {
    private final String id;
    private final String category;
    private final Map<String, Object> content;
    private final String rawJson;

    public AssetDetail(String id, String category, Map<String, Object> content, String rawJson) {
        this.id = id;
        this.category = category;
        this.content = content;
        this.rawJson = rawJson;
    }

    public String getId() {
        return id;
    }

    public String getCategory() {
        return category;
    }

    public Map<String, Object> getContent() {
        return content;
    }

    public String getRawJson() {
        return rawJson;
    }

    /**
     * Builder for creating AssetDetail instances.
     */
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String id;
        private String category;
        private Map<String, Object> content;
        private String rawJson;

        public Builder id(String id) {
            this.id = id;
            return this;
        }

        public Builder category(String category) {
            this.category = category;
            return this;
        }

        public Builder content(Map<String, Object> content) {
            this.content = content;
            return this;
        }

        public Builder rawJson(String rawJson) {
            this.rawJson = rawJson;
            return this;
        }

        public AssetDetail build() {
            return new AssetDetail(id, category, content, rawJson);
        }
    }
}
