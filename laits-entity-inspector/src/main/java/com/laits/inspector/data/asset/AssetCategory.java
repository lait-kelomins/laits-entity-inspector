package com.laits.inspector.data.asset;

/**
 * Represents a category of assets, grouped by package.
 */
public class AssetCategory {
    private final String id;
    private final String displayName;
    private final String packageGroup;
    private final int count;

    public AssetCategory(String id, String displayName, String packageGroup, int count) {
        this.id = id;
        this.displayName = displayName;
        this.packageGroup = packageGroup;
        this.count = count;
    }

    public String getId() {
        return id;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getPackageGroup() {
        return packageGroup;
    }

    public int getCount() {
        return count;
    }

    /**
     * Builder for creating AssetCategory instances.
     */
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private String id;
        private String displayName;
        private String packageGroup;
        private int count;

        public Builder id(String id) {
            this.id = id;
            return this;
        }

        public Builder displayName(String displayName) {
            this.displayName = displayName;
            return this;
        }

        public Builder packageGroup(String packageGroup) {
            this.packageGroup = packageGroup;
            return this;
        }

        public Builder count(int count) {
            this.count = count;
            return this;
        }

        public AssetCategory build() {
            return new AssetCategory(id, displayName, packageGroup, count);
        }
    }
}
