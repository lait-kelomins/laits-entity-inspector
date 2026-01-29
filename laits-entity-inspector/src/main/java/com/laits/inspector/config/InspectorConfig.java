package com.laits.inspector.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.hypixel.hytale.logger.HytaleLogger;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Configuration for the Entity Inspector plugin.
 * Loaded from JSON file with sensible defaults.
 */
public class InspectorConfig {
    private static final HytaleLogger LOGGER = HytaleLogger.forEnclosingClass();
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    // General settings
    private boolean enabled = true;
    private int updateIntervalTicks = 3;  // ~100ms at 30 TPS
    private boolean includeNPCs = true;
    private boolean includePlayers = true;
    private boolean includeItems = false;
    private int maxCachedEntities = 5000;
    private int maxCachedPackets = 2000;

    // WebSocket transport settings
    private WebSocketConfig websocket = new WebSocketConfig();

    // Packet logging settings
    private PacketLogConfig packetLog = new PacketLogConfig();

    // Transient - not serialized
    private transient Path configPath;

    public static class WebSocketConfig {
        private boolean enabled = true;
        private int port = 8765;
        private String bindAddress = "127.0.0.1";
        private int maxClients = 10;

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public int getPort() {
            return port;
        }

        public void setPort(int port) {
            this.port = port;
        }

        public String getBindAddress() {
            return bindAddress;
        }

        public void setBindAddress(String bindAddress) {
            this.bindAddress = bindAddress;
        }

        public int getMaxClients() {
            return maxClients;
        }

        public void setMaxClients(int maxClients) {
            this.maxClients = maxClients;
        }
    }

    public static class PacketLogConfig {
        private boolean enabled = true;
        private List<String> excludedPackets = new ArrayList<>();

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public List<String> getExcludedPackets() {
            return excludedPackets;
        }

        public void setExcludedPackets(List<String> excludedPackets) {
            this.excludedPackets = excludedPackets;
        }

        public boolean isPacketExcluded(String packetName) {
            if (excludedPackets == null || excludedPackets.isEmpty()) {
                return false;
            }
            for (String excluded : excludedPackets) {
                if (packetName.contains(excluded)) {
                    return true;
                }
            }
            return false;
        }
    }

    // Getters and setters

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public int getUpdateIntervalTicks() {
        return updateIntervalTicks;
    }

    public void setUpdateIntervalTicks(int updateIntervalTicks) {
        this.updateIntervalTicks = Math.max(1, updateIntervalTicks);
    }

    public int getUpdateIntervalMs() {
        // 30 TPS = ~33ms per tick
        return updateIntervalTicks * 33;
    }

    public void setUpdateIntervalMs(int ms) {
        // Convert ms to ticks (round up to ensure at least 1 tick)
        this.updateIntervalTicks = Math.max(1, (ms + 32) / 33);
    }

    public boolean isIncludeNPCs() {
        return includeNPCs;
    }

    public void setIncludeNPCs(boolean includeNPCs) {
        this.includeNPCs = includeNPCs;
    }

    public boolean isIncludePlayers() {
        return includePlayers;
    }

    public void setIncludePlayers(boolean includePlayers) {
        this.includePlayers = includePlayers;
    }

    public boolean isIncludeItems() {
        return includeItems;
    }

    public void setIncludeItems(boolean includeItems) {
        this.includeItems = includeItems;
    }

    public int getMaxCachedEntities() {
        return maxCachedEntities;
    }

    public void setMaxCachedEntities(int maxCachedEntities) {
        this.maxCachedEntities = Math.max(100, maxCachedEntities);
    }

    public int getMaxCachedPackets() {
        return maxCachedPackets;
    }

    public void setMaxCachedPackets(int maxCachedPackets) {
        this.maxCachedPackets = Math.max(100, maxCachedPackets);
    }

    public WebSocketConfig getWebsocket() {
        return websocket;
    }

    public PacketLogConfig getPacketLog() {
        return packetLog;
    }

    /**
     * Load configuration from file, creating default if not exists.
     */
    public static InspectorConfig load(Path path) {
        InspectorConfig config;

        if (Files.exists(path)) {
            try (Reader reader = Files.newBufferedReader(path)) {
                config = GSON.fromJson(reader, InspectorConfig.class);
                if (config == null) {
                    config = new InspectorConfig();
                }
                LOGGER.atInfo().log("Loaded inspector config from %s", path);
            } catch (IOException e) {
                LOGGER.atWarning().log("Failed to load config, using defaults: %s", e.getMessage());
                config = new InspectorConfig();
            }
        } else {
            config = new InspectorConfig();
            config.save(path);
            LOGGER.atInfo().log("Created default inspector config at %s", path);
        }

        config.configPath = path;
        return config;
    }

    /**
     * Save configuration to file.
     */
    public void save(Path path) {
        try {
            Files.createDirectories(path.getParent());
            try (Writer writer = Files.newBufferedWriter(path)) {
                GSON.toJson(this, writer);
            }
        } catch (IOException e) {
            LOGGER.atWarning().log("Failed to save config to %s: %s", path, e.getMessage());
        }
    }

    /**
     * Reload configuration from file.
     */
    public void reload() {
        if (configPath != null) {
            InspectorConfig reloaded = load(configPath);
            this.enabled = reloaded.enabled;
            this.updateIntervalTicks = reloaded.updateIntervalTicks;
            this.includeNPCs = reloaded.includeNPCs;
            this.includePlayers = reloaded.includePlayers;
            this.includeItems = reloaded.includeItems;
            this.maxCachedEntities = reloaded.maxCachedEntities;
            this.maxCachedPackets = reloaded.maxCachedPackets;
            this.websocket = reloaded.websocket;
            this.packetLog = reloaded.packetLog;
            LOGGER.atInfo().log("Reloaded inspector config");
        }
    }

    /**
     * Save to the originally loaded path.
     */
    public void save() {
        if (configPath != null) {
            save(configPath);
        }
    }
}
