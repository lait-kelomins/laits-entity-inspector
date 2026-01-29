package com.laits.inspector.data.asset;

/**
 * Represents feature flags sent to the client on connect.
 */
public class FeatureInfo {
    private final boolean hytalorEnabled;
    private final String draftDirectory;
    private final String patchDirectory;
    private final String patchAssetPackName;

    public FeatureInfo(boolean hytalorEnabled, String draftDirectory, String patchDirectory, String patchAssetPackName) {
        this.hytalorEnabled = hytalorEnabled;
        this.draftDirectory = draftDirectory;
        this.patchDirectory = patchDirectory;
        this.patchAssetPackName = patchAssetPackName;
    }

    public boolean isHytalorEnabled() {
        return hytalorEnabled;
    }

    public String getDraftDirectory() {
        return draftDirectory;
    }

    public String getPatchDirectory() {
        return patchDirectory;
    }

    public String getPatchAssetPackName() {
        return patchAssetPackName;
    }

    /**
     * Builder for creating FeatureInfo instances.
     */
    public static Builder builder() {
        return new Builder();
    }

    public static class Builder {
        private boolean hytalorEnabled;
        private String draftDirectory;
        private String patchDirectory;
        private String patchAssetPackName;

        public Builder hytalorEnabled(boolean hytalorEnabled) {
            this.hytalorEnabled = hytalorEnabled;
            return this;
        }

        public Builder draftDirectory(String draftDirectory) {
            this.draftDirectory = draftDirectory;
            return this;
        }

        public Builder patchDirectory(String patchDirectory) {
            this.patchDirectory = patchDirectory;
            return this;
        }

        public Builder patchAssetPackName(String patchAssetPackName) {
            this.patchAssetPackName = patchAssetPackName;
            return this;
        }

        public FeatureInfo build() {
            return new FeatureInfo(hytalorEnabled, draftDirectory, patchDirectory, patchAssetPackName);
        }
    }
}
