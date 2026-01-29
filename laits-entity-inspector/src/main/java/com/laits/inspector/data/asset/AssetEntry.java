package com.laits.inspector.data.asset;

/**
 * Represents a single asset entry in a category.
 */
public class AssetEntry {
    private final String id;
    private final String category;
    private final String typeHint;

    public AssetEntry(String id, String category, String typeHint) {
        this.id = id;
        this.category = category;
        this.typeHint = typeHint;
    }

    public String getId() {
        return id;
    }

    public String getCategory() {
        return category;
    }

    public String getTypeHint() {
        return typeHint;
    }

    /**
     * Builder for creating AssetEntry instances.
     */
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String id;
        private String category;
        private String typeHint;

        public Builder id(String id) {
            this.id = id;
            return this;
        }

        public Builder category(String category) {
            this.category = category;
            return this;
        }

        public Builder typeHint(String typeHint) {
            this.typeHint = typeHint;
            return this;
        }

        public AssetEntry build() {
            return new AssetEntry(id, category, typeHint);
        }
    }
}
