package com.laits.inspector.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.hypixel.hytale.assetstore.AssetMap;
import com.hypixel.hytale.assetstore.AssetPack;
import com.hypixel.hytale.assetstore.AssetRegistry;
import com.hypixel.hytale.assetstore.AssetStore;
import com.hypixel.hytale.assetstore.map.JsonAssetWithMap;
import com.hypixel.hytale.logger.HytaleLogger;
import com.hypixel.hytale.server.core.asset.AssetModule;
import com.laits.inspector.data.asset.AssetCategory;
import com.laits.inspector.data.asset.AssetDetail;
import com.laits.inspector.data.asset.AssetEntry;

import java.io.IOException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Discovers and collects all asset types via AssetRegistry and file system.
 * Groups assets by directory for UI display.
 */
public class AssetCollector {
    private static final HytaleLogger LOGGER = HytaleLogger.forEnclosingClass();
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    // Grace period delay for second initialization (allows mods to finish loading)
    private static final int GRACE_PERIOD_SECONDS = 5;
    // Delay after patch before refresh (allows patch to be applied)
    private static final int PATCH_REFRESH_DELAY_SECONDS = 2;

    // Cache of discovered asset types from AssetRegistry
    private final Map<String, AssetTypeInfo> assetTypes = new ConcurrentHashMap<>();
    private final Map<String, List<AssetTypeInfo>> typesByPackage = new ConcurrentHashMap<>();

    // Cache of file-based assets (relative path without extension -> absolute path)
    // e.g., "Weathers/Zone1/Zone1_Sunny" -> Path to actual file
    private final Map<String, Path> fileAssetPaths = new ConcurrentHashMap<>();

    // Categories discovered from file system (directory name -> list of asset IDs)
    private final Map<String, List<String>> fileCategories = new ConcurrentHashMap<>();

    // Track if discovery has been run
    private volatile boolean initialized = false;

    // Track if grace period refresh has been scheduled
    private final AtomicBoolean gracePeriodScheduled = new AtomicBoolean(false);

    // Scheduler for delayed refreshes
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "AssetCollector-Scheduler");
        t.setDaemon(true);
        return t;
    });

    // Callback for notifying when refresh completes (set by InspectorCore)
    private volatile Runnable onRefreshComplete;

    /**
     * Information about a discovered asset type.
     */
    public static class AssetTypeInfo {
        private final String id;
        private final String displayName;
        private final String packageGroup;
        private final Class<?> assetClass;
        private AssetStore<?, ?, ?> assetStore;

        public AssetTypeInfo(String id, String displayName, String packageGroup, Class<?> assetClass) {
            this.id = id;
            this.displayName = displayName;
            this.packageGroup = packageGroup;
            this.assetClass = assetClass;
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

        public Class<?> getAssetClass() {
            return assetClass;
        }

        public AssetStore<?, ?, ?> getAssetStore() {
            return assetStore;
        }

        public void setAssetStore(AssetStore<?, ?, ?> assetStore) {
            this.assetStore = assetStore;
        }
    }

    /**
     * Set callback to be invoked when a refresh completes.
     * Used by InspectorCore to broadcast refresh events to clients.
     */
    public void setOnRefreshComplete(Runnable callback) {
        this.onRefreshComplete = callback;
    }

    /**
     * Initialize asset discovery using AssetRegistry.
     * Performs immediate scan, then schedules a grace period re-scan to pick up late-loading mods.
     */
    public synchronized void initialize() {
        if (initialized) {
            LOGGER.atInfo().log("AssetCollector.initialize() called but already initialized - skipping (categories=%d, assets=%d)",
                    fileCategories.size(), fileAssetPaths.size());
            return;
        }
        LOGGER.atInfo().log("AssetCollector.initialize() - first time initialization starting");
        discoverAssetTypes();
        initialized = true;
        LOGGER.atInfo().log("AssetCollector.initialize() complete - categories=%d, assets=%d",
                fileCategories.size(), fileAssetPaths.size());

        // Schedule grace period refresh to pick up late-loading mods
        scheduleGracePeriodRefresh();
    }

    /**
     * Refresh asset collection - clears caches and re-scans everything.
     * Call this after mods/patches have loaded to pick up new assets.
     */
    public synchronized void refresh() {
        LOGGER.atInfo().log("Refreshing asset collection...");
        discoverAssetTypes();  // Re-scan everything (this clears caches internally)
        initialized = true;    // Ensure we stay initialized
        LOGGER.atInfo().log("Asset refresh complete. Found %d categories with %d total assets.",
                fileCategories.size(), fileAssetPaths.size());
    }

    /**
     * Schedule a grace period refresh to pick up late-loading mods.
     * Only schedules once per plugin lifetime.
     */
    private void scheduleGracePeriodRefresh() {
        if (gracePeriodScheduled.compareAndSet(false, true)) {
            LOGGER.atInfo().log("Scheduling grace period refresh in %d seconds...", GRACE_PERIOD_SECONDS);
            scheduler.schedule(() -> {
                LOGGER.atInfo().log("Grace period elapsed - performing automatic refresh to pick up late-loading mods");
                refresh();
                notifyRefreshComplete();
            }, GRACE_PERIOD_SECONDS, TimeUnit.SECONDS);
        }
    }

    /**
     * Schedule a delayed refresh (e.g., after patch publish).
     * Used to give time for patches to be applied before re-scanning.
     */
    public void scheduleDelayedRefresh() {
        LOGGER.atInfo().log("Scheduling delayed refresh in %d seconds...", PATCH_REFRESH_DELAY_SECONDS);
        scheduler.schedule(() -> {
            LOGGER.atInfo().log("Delayed refresh triggered");
            refresh();
            notifyRefreshComplete();
        }, PATCH_REFRESH_DELAY_SECONDS, TimeUnit.SECONDS);
    }

    /**
     * Notify listeners that refresh is complete.
     */
    private void notifyRefreshComplete() {
        Runnable callback = onRefreshComplete;
        if (callback != null) {
            try {
                callback.run();
            } catch (Exception e) {
                LOGGER.atWarning().log("Error in refresh complete callback: %s", e.getMessage());
            }
        }
    }

    /**
     * Discover all asset types via AssetRegistry and file system.
     */
    public void discoverAssetTypes() {
        LOGGER.atInfo().log("Discovering asset types...");

        // Clear existing cache
        assetTypes.clear();
        typesByPackage.clear();
        fileAssetPaths.clear();
        fileCategories.clear();

        // Find asset types through AssetRegistry
        discoverFromAssetRegistry();

        // Discover assets from file system (base game + mods)
        discoverFromFileSystem();

        // Group by package
        for (AssetTypeInfo info : assetTypes.values()) {
            typesByPackage.computeIfAbsent(info.getPackageGroup(), k -> new ArrayList<>()).add(info);
        }

        LOGGER.atInfo().log("Discovered %d asset types in %d packages, %d file-based categories with %d assets",
                assetTypes.size(), typesByPackage.size(), fileCategories.size(), fileAssetPaths.size());
    }

    /**
     * Discover assets by walking the file system of all asset packs.
     * Similar to how Hytalor caches asset paths.
     */
    private void discoverFromFileSystem() {
        try {
            List<AssetPack> assetPacks = AssetModule.get().getAssetPacks();
            LOGGER.atInfo().log("Scanning %d asset packs for files...", assetPacks.size());

            // Log each pack name for debugging
            for (int i = 0; i < assetPacks.size(); i++) {
                AssetPack pack = assetPacks.get(i);
                LOGGER.atInfo().log("  Pack[%d]: %s at %s", i, pack.getName(), pack.getRoot());
            }

            for (AssetPack pack : assetPacks) {
                int beforeCount = fileAssetPaths.size();
                cacheAssetPathsFromPack(pack);
                int afterCount = fileAssetPaths.size();
                LOGGER.atInfo().log("  Pack '%s' contributed %d assets (total now: %d)",
                        pack.getName(), afterCount - beforeCount, afterCount);
            }
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to discover assets from file system: %s", e.getMessage());
        }
    }

    /**
     * Cache all JSON asset paths from an asset pack's Server/ directory.
     */
    private void cacheAssetPathsFromPack(AssetPack pack) {
        Path serverPath = pack.getRoot().resolve("Server");

        if (!Files.isDirectory(serverPath)) {
            LOGGER.atInfo().log("No Server directory in pack: %s", pack.getName());
            return;
        }

        LOGGER.atInfo().log("Scanning pack: %s at %s", pack.getName(), serverPath);

        try {
            Files.walkFileTree(serverPath, new SimpleFileVisitor<Path>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    if (isJsonFile(file) && !isIgnoredFile(file)) {
                        // Get relative path from Server/ directory
                        String relativePath = serverPath.relativize(file).toString()
                                .replace(".json", "")
                                .replace("\\", "/");

                        // Extract category (first directory level)
                        String category = extractCategoryFromPath(relativePath);

                        // Cache the path
                        fileAssetPaths.put(relativePath, file);

                        // Add to category
                        fileCategories.computeIfAbsent(category, k -> new ArrayList<>())
                                .add(relativePath);
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFileFailed(Path file, IOException exc) {
                    // Skip files we can't read
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException e) {
            LOGGER.atWarning().log("Failed to scan pack %s: %s", pack.getName(), e.getMessage());
        }
    }

    /**
     * Extract the category (top-level directory) from a relative path.
     */
    private String extractCategoryFromPath(String relativePath) {
        int slashIndex = relativePath.indexOf('/');
        if (slashIndex > 0) {
            return relativePath.substring(0, slashIndex);
        }
        return relativePath;
    }

    /**
     * Check if a file is a JSON file.
     */
    private static boolean isJsonFile(Path path) {
        return Files.isRegularFile(path) && path.toString().endsWith(".json");
    }

    /**
     * Check if a file should be ignored (starts with !).
     */
    private static boolean isIgnoredFile(Path path) {
        String filename = path.getFileName().toString();
        return !filename.isEmpty() && filename.charAt(0) == '!';
    }

    /**
     * Discover asset types from AssetRegistry.
     * Uses thread-safe access via AssetRegistry.ASSET_LOCK.
     */
    @SuppressWarnings("unchecked")
    private void discoverFromAssetRegistry() {
        // Thread-safe access to asset registry
        AssetRegistry.ASSET_LOCK.readLock().lock();
        try {
            // Get all registered asset stores from AssetRegistry
            Map<Class<? extends JsonAssetWithMap>, AssetStore<?, ?, ?>> storeMap = AssetRegistry.getStoreMap();

            LOGGER.atInfo().log("AssetRegistry has %d registered stores", storeMap.size());

            for (Map.Entry<Class<? extends JsonAssetWithMap>, AssetStore<?, ?, ?>> entry : storeMap.entrySet()) {
                Class<? extends JsonAssetWithMap> assetClass = entry.getKey();
                AssetStore<?, ?, ?> store = entry.getValue();

                if (store == null) {
                    LOGGER.atWarning().log("Null store for class: %s", assetClass.getSimpleName());
                    continue;
                }

                try {
                    // Extract type information from the asset class
                    String typeName = assetClass.getSimpleName();
                    String packageGroup = extractPackageGroup(assetClass);

                    // Get asset count from the store's AssetMap
                    int assetCount = 0;
                    try {
                        assetCount = store.getAssetMap().getAssetCount();
                    } catch (Exception e) {
                        LOGGER.atWarning().log("Failed to get asset count for %s: %s", typeName, e.getMessage());
                    }

                    AssetTypeInfo info = new AssetTypeInfo(
                            typeName,
                            formatDisplayName(typeName),
                            packageGroup,
                            assetClass
                    );
                    info.setAssetStore((AssetStore<?, ?, ?>) store);

                    assetTypes.put(typeName, info);

                    LOGGER.atInfo().log("Discovered asset type: %s (path: %s, count: %d)",
                            typeName, store.getPath(), assetCount);

                } catch (Exception e) {
                    LOGGER.atWarning().log("Failed to process asset type %s: %s",
                            assetClass.getSimpleName(), e.getMessage());
                }
            }
        } catch (Exception e) {
            LOGGER.atSevere().withCause(e).log("Failed to discover asset types from registry");
        } finally {
            AssetRegistry.ASSET_LOCK.readLock().unlock();
        }
    }

    /**
     * Get the count of assets in a store using getAssetMap().getAssetCount().
     */
    private int getAssetCount(AssetStore<?, ?, ?> store) {
        try {
            return store.getAssetMap().getAssetCount();
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to get asset count: %s", e.getMessage());
            return 0;
        }
    }

    /**
     * Extract package group from class.
     */
    private String extractPackageGroup(Class<?> clazz) {
        String pkg = clazz.getPackageName();

        // Simplify package name for display
        if (pkg.contains("asset.type")) {
            return "Asset Types";
        } else if (pkg.contains("npc.config")) {
            return "NPC Config";
        } else if (pkg.contains("modules")) {
            return "Modules";
        } else if (pkg.contains("asset")) {
            return "Assets";
        } else {
            // Use last part of package name
            String[] parts = pkg.split("\\.");
            return parts.length > 0 ? capitalize(parts[parts.length - 1]) : "Other";
        }
    }

    /**
     * Format type name for display.
     */
    private String formatDisplayName(String typeName) {
        // Add spaces before capital letters
        return typeName.replaceAll("([a-z])([A-Z])", "$1 $2");
    }

    /**
     * Capitalize first letter.
     */
    private String capitalize(String s) {
        if (s == null || s.isEmpty()) return s;
        return s.substring(0, 1).toUpperCase() + s.substring(1);
    }

    // ═══════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get all asset categories - combines AssetRegistry types and file-based categories.
     * Auto-initializes on first call if not already initialized.
     */
    public List<AssetCategory> getCategories() {
        // Auto-initialize on first call
        if (!initialized) {
            LOGGER.atInfo().log("Auto-initializing AssetCollector on first getCategories() call");
            initialize();
        }
        LOGGER.atInfo().log("getCategories() called - initialized=%b, fileCategories=%d, fileAssets=%d, registryTypes=%d",
                initialized, fileCategories.size(), fileAssetPaths.size(), assetTypes.size());

        List<AssetCategory> categories = new ArrayList<>();

        // Add AssetRegistry-based categories
        for (Map.Entry<String, List<AssetTypeInfo>> entry : typesByPackage.entrySet()) {
            String packageGroup = entry.getKey();
            for (AssetTypeInfo info : entry.getValue()) {
                int count = info.getAssetStore() != null ? getAssetCount(info.getAssetStore()) : 0;
                categories.add(AssetCategory.builder()
                        .id(info.getId())
                        .displayName(info.getDisplayName())
                        .packageGroup(packageGroup)
                        .count(count)
                        .build());
            }
        }

        // Add file-based categories (from Server/ directory scan)
        for (Map.Entry<String, List<String>> entry : fileCategories.entrySet()) {
            String category = entry.getKey();
            int count = entry.getValue().size();

            // Skip if we already have this category from AssetRegistry
            boolean alreadyExists = categories.stream()
                    .anyMatch(c -> c.getId().equalsIgnoreCase(category));

            if (!alreadyExists) {
                categories.add(AssetCategory.builder()
                        .id(category)
                        .displayName(formatDisplayName(category))
                        .packageGroup("Game Assets")  // Group all file-based under "Game Assets"
                        .count(count)
                        .build());
            }
        }

        // Sort by package group, then by display name
        categories.sort(Comparator
                .comparing(AssetCategory::getPackageGroup)
                .thenComparing(AssetCategory::getDisplayName));

        return categories;
    }

    /**
     * Get assets in a category with optional filter.
     * Checks both AssetRegistry and file-based categories.
     */
    public List<AssetEntry> getAssets(String category, String filter) {
        if (!initialized) {
            initialize();
        }
        List<AssetEntry> entries = new ArrayList<>();
        String filterLower = filter != null ? filter.toLowerCase() : null;

        // Try AssetRegistry first
        AssetTypeInfo info = assetTypes.get(category);
        if (info != null && info.getAssetStore() != null) {
            try {
                AssetStore<?, ?, ?> store = info.getAssetStore();
                Collection<?> assets = getAssetsFromStore(store);

                for (Object asset : assets) {
                    String assetId = extractAssetId(asset);
                    if (assetId == null) continue;

                    if (filterLower != null && !assetId.toLowerCase().contains(filterLower)) {
                        continue;
                    }

                    entries.add(AssetEntry.builder()
                            .id(assetId)
                            .category(category)
                            .typeHint(asset.getClass().getSimpleName())
                            .build());
                }
            } catch (Exception e) {
                LOGGER.atWarning().log("Failed to get assets from store for category %s: %s",
                        category, e.getMessage());
            }
        }

        // Also check file-based categories
        List<String> fileAssets = fileCategories.get(category);
        if (fileAssets != null) {
            for (String assetPath : fileAssets) {
                // Extract just the asset name from the path
                String assetId = extractAssetIdFromPath(assetPath);

                if (filterLower != null && !assetId.toLowerCase().contains(filterLower)
                        && !assetPath.toLowerCase().contains(filterLower)) {
                    continue;
                }

                // Skip if already added from AssetRegistry
                String finalAssetId = assetId;
                boolean alreadyAdded = entries.stream()
                        .anyMatch(e -> e.getId().equals(finalAssetId));

                if (!alreadyAdded) {
                    entries.add(AssetEntry.builder()
                            .id(assetPath)  // Use full path as ID for file-based
                            .category(category)
                            .typeHint("JSON File")
                            .build());
                }
            }
        }

        // Sort by ID
        entries.sort(Comparator.comparing(AssetEntry::getId));

        return entries;
    }

    /**
     * Extract the asset ID (filename without extension) from a relative path.
     */
    private String extractAssetIdFromPath(String relativePath) {
        int lastSlash = relativePath.lastIndexOf('/');
        if (lastSlash >= 0) {
            return relativePath.substring(lastSlash + 1);
        }
        return relativePath;
    }

    /**
     * Search all assets across all categories (both AssetRegistry and file-based).
     */
    public List<AssetEntry> searchAllAssets(String query) {
        if (!initialized) {
            initialize();
        }
        List<AssetEntry> results = new ArrayList<>();
        String queryLower = query != null ? query.toLowerCase() : "";
        Set<String> addedIds = new HashSet<>();  // Track to avoid duplicates

        // Search AssetRegistry-based assets
        for (AssetTypeInfo info : assetTypes.values()) {
            if (info.getAssetStore() == null) continue;

            try {
                Collection<?> assets = getAssetsFromStore(info.getAssetStore());

                for (Object asset : assets) {
                    String assetId = extractAssetId(asset);
                    if (assetId == null) continue;

                    if (assetId.toLowerCase().contains(queryLower)) {
                        results.add(AssetEntry.builder()
                                .id(assetId)
                                .category(info.getId())
                                .typeHint(asset.getClass().getSimpleName())
                                .build());
                        addedIds.add(assetId.toLowerCase());
                    }
                }
            } catch (Exception e) {
                // Continue to next type
            }
        }

        // Search file-based assets
        for (Map.Entry<String, Path> entry : fileAssetPaths.entrySet()) {
            String assetPath = entry.getKey();

            if (assetPath.toLowerCase().contains(queryLower)) {
                // Extract category from path
                String category = extractCategoryFromPath(assetPath);
                String assetId = extractAssetIdFromPath(assetPath);

                // Skip if already added from AssetRegistry
                if (!addedIds.contains(assetId.toLowerCase())) {
                    results.add(AssetEntry.builder()
                            .id(assetPath)
                            .category(category)
                            .typeHint("JSON File")
                            .build());
                }
            }
        }

        // Sort by relevance (exact match first, then by ID)
        results.sort((a, b) -> {
            boolean aExact = a.getId().equalsIgnoreCase(query);
            boolean bExact = b.getId().equalsIgnoreCase(query);
            if (aExact != bExact) return aExact ? -1 : 1;
            return a.getId().compareToIgnoreCase(b.getId());
        });

        // Limit results
        if (results.size() > 100) {
            return results.subList(0, 100);
        }

        return results;
    }

    /**
     * Get detailed asset information.
     * Tries AssetRegistry first, then falls back to reading JSON file.
     */
    public AssetDetail getAssetDetail(String category, String assetId) {
        if (!initialized) {
            initialize();
        }
        // Try AssetRegistry first
        AssetTypeInfo info = assetTypes.get(category);
        if (info != null && info.getAssetStore() != null) {
            try {
                Object asset = getAssetById(info.getAssetStore(), assetId);
                if (asset != null) {
                    Map<String, Object> content = serializeAsset(asset);
                    String rawJson = GSON.toJson(content);

                    return AssetDetail.builder()
                            .id(assetId)
                            .category(category)
                            .content(content)
                            .rawJson(rawJson)
                            .build();
                }
            } catch (Exception e) {
                LOGGER.atWarning().log("Failed to get asset from store for %s/%s: %s",
                        category, assetId, e.getMessage());
            }
        }

        // Try file-based lookup
        // The assetId might be a full relative path like "Weathers/Zone1/Zone1_Sunny"
        Path filePath = fileAssetPaths.get(assetId);
        if (filePath == null) {
            // Try constructing the path from category + assetId
            String constructedPath = category + "/" + assetId;
            filePath = fileAssetPaths.get(constructedPath);
        }

        if (filePath != null && Files.exists(filePath)) {
            try {
                String rawJson = Files.readString(filePath);
                JsonObject jsonObject = JsonParser.parseString(rawJson).getAsJsonObject();
                Map<String, Object> content = jsonToMap(jsonObject);

                return AssetDetail.builder()
                        .id(assetId)
                        .category(category)
                        .content(content)
                        .rawJson(GSON.toJson(jsonObject))  // Pretty print
                        .build();

            } catch (Exception e) {
                LOGGER.atWarning().log("Failed to read asset file %s: %s",
                        filePath, e.getMessage());
            }
        }

        LOGGER.atWarning().log("Asset not found: %s/%s", category, assetId);
        return null;
    }

    /**
     * Convert a JsonObject to a Map for serialization.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> jsonToMap(JsonObject jsonObject) {
        Map<String, Object> map = new LinkedHashMap<>();

        for (Map.Entry<String, JsonElement> entry : jsonObject.entrySet()) {
            map.put(entry.getKey(), jsonElementToObject(entry.getValue()));
        }

        return map;
    }

    /**
     * Convert a JsonElement to a Java object.
     */
    private Object jsonElementToObject(JsonElement element) {
        if (element.isJsonNull()) {
            return null;
        } else if (element.isJsonPrimitive()) {
            var primitive = element.getAsJsonPrimitive();
            if (primitive.isBoolean()) {
                return primitive.getAsBoolean();
            } else if (primitive.isNumber()) {
                // Try to preserve integer vs decimal
                double d = primitive.getAsDouble();
                if (d == Math.floor(d) && !Double.isInfinite(d)) {
                    return primitive.getAsLong();
                }
                return d;
            } else {
                return primitive.getAsString();
            }
        } else if (element.isJsonArray()) {
            List<Object> list = new ArrayList<>();
            for (JsonElement e : element.getAsJsonArray()) {
                list.add(jsonElementToObject(e));
            }
            return list;
        } else if (element.isJsonObject()) {
            return jsonToMap(element.getAsJsonObject());
        }
        return element.toString();
    }

    /**
     * Test which assets match a wildcard path (like Hytalor's BaseAssetPath).
     * Uses glob-style matching: * matches within a directory, ** matches across directories.
     */
    public List<String> testWildcard(String wildcardPath) {
        if (!initialized) {
            initialize();
        }
        List<String> matches = new ArrayList<>();

        if (wildcardPath == null || wildcardPath.isEmpty()) {
            return matches;
        }

        // Convert glob to regex (like Hytalor's QueryUtil.globToRegex)
        Pattern pattern = globToRegex(wildcardPath);

        // Search file-based assets (primary source for wildcard matching)
        for (String assetPath : fileAssetPaths.keySet()) {
            if (pattern.matcher(assetPath).matches()) {
                matches.add(assetPath);
            }
        }

        // Also search AssetRegistry-based assets
        for (AssetTypeInfo info : assetTypes.values()) {
            if (info.getAssetStore() == null) continue;

            try {
                Collection<?> assets = getAssetsFromStore(info.getAssetStore());
                String storePath = info.getAssetStore().getPath();

                for (Object asset : assets) {
                    String assetId = extractAssetId(asset);
                    if (assetId == null) continue;

                    // Construct path like "Weathers/Zone1_Sunny"
                    String fullPath = storePath != null
                            ? storePath + "/" + assetId
                            : assetId;

                    if (pattern.matcher(fullPath).matches()) {
                        if (!matches.contains(fullPath)) {
                            matches.add(fullPath);
                        }
                    }
                }
            } catch (Exception e) {
                // Continue
            }
        }

        // Sort results
        Collections.sort(matches);

        return matches;
    }

    /**
     * Convert a glob pattern to a regex Pattern (like Hytalor's QueryUtil).
     * Supports: * (single level), ** (recursive), ? (single char)
     */
    private Pattern globToRegex(String glob) {
        StringBuilder regex = new StringBuilder("^");

        for (int i = 0; i < glob.length(); i++) {
            char c = glob.charAt(i);

            switch (c) {
                case '*' -> {
                    if (i + 1 < glob.length() && glob.charAt(i + 1) == '*') {
                        regex.append(".*");  // ** matches anything including /
                        i++;  // skip second *
                    } else {
                        regex.append("[^/]*");  // * matches anything except /
                    }
                }
                case '?' -> regex.append('.');
                case '.' -> regex.append("\\.");
                case '/' -> regex.append("/");
                case '\\' -> regex.append("\\\\");
                case '[', ']', '(', ')', '{', '}', '^', '$', '+', '|' ->
                        regex.append("\\").append(c);
                default -> regex.append(c);
            }
        }

        regex.append("$");
        return Pattern.compile(regex.toString(), Pattern.CASE_INSENSITIVE);
    }

    // ═══════════════════════════════════════════════════════════════
    // HELPER METHODS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get all assets from a store.
     */
    @SuppressWarnings("unchecked")
    private Collection<?> getAssetsFromStore(AssetStore<?, ?, ?> store) throws Exception {
        // Try various methods to get assets
        for (String methodName : Arrays.asList("getAll", "values", "getAllAssets")) {
            try {
                Method m = store.getClass().getMethod(methodName);
                Object result = m.invoke(store);
                if (result instanceof Collection<?>) {
                    return (Collection<?>) result;
                } else if (result instanceof Map<?, ?>) {
                    return ((Map<?, ?>) result).values();
                }
            } catch (NoSuchMethodException e) {
                // Try next method
            }
        }

        return Collections.emptyList();
    }

    /**
     * Get asset by ID from store.
     */
    private Object getAssetById(AssetStore<?, ?, ?> store, String assetId) throws Exception {
        // Try various methods to get asset by ID
        for (String methodName : Arrays.asList("get", "getById", "getAsset")) {
            try {
                Method m = store.getClass().getMethod(methodName, String.class);
                Object result = m.invoke(store, assetId);
                if (result != null) {
                    return result;
                }
            } catch (NoSuchMethodException e) {
                // Try next method
            }
        }

        // Try with Object parameter
        try {
            Method m = store.getClass().getMethod("get", Object.class);
            return m.invoke(store, assetId);
        } catch (NoSuchMethodException e) {
            // Not found
        }

        return null;
    }

    /**
     * Extract asset ID from asset object.
     */
    private String extractAssetId(Object asset) {
        // Try various methods to get ID
        for (String methodName : Arrays.asList("getId", "id", "getName", "getAssetId")) {
            try {
                Method m = asset.getClass().getMethod(methodName);
                Object result = m.invoke(asset);
                if (result != null) {
                    return result.toString();
                }
            } catch (Exception e) {
                // Try next method
            }
        }

        return null;
    }

    /**
     * Serialize asset to Map using reflection.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> serializeAsset(Object asset) {
        // Use ComponentSerializer-style serialization
        Map<String, Object> result = new LinkedHashMap<>();

        // Add type
        result.put("_type", asset.getClass().getSimpleName());

        // Serialize fields
        for (java.lang.reflect.Field field : asset.getClass().getDeclaredFields()) {
            if (Modifier.isStatic(field.getModifiers()) || Modifier.isTransient(field.getModifiers())) {
                continue;
            }

            try {
                field.setAccessible(true);
                Object value = field.get(asset);

                if (value != null) {
                    result.put(field.getName(), serializeValue(value, 0));
                }
            } catch (Exception e) {
                // Skip field
            }
        }

        return result;
    }

    /**
     * Serialize a value to a JSON-compatible format.
     */
    private Object serializeValue(Object value, int depth) {
        if (value == null) return null;
        if (depth > 5) {
            // Prevent infinite recursion
            return Map.of("_expandable", true, "_type", value.getClass().getSimpleName());
        }

        Class<?> type = value.getClass();

        // Primitives and strings
        if (type.isPrimitive() || value instanceof Number || value instanceof Boolean ||
                value instanceof String || value instanceof Enum) {
            return value.toString();
        }

        // Collections
        if (value instanceof Collection<?>) {
            List<Object> list = new ArrayList<>();
            for (Object item : (Collection<?>) value) {
                list.add(serializeValue(item, depth + 1));
            }
            return list;
        }

        // Maps
        if (value instanceof Map<?, ?>) {
            Map<String, Object> map = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                map.put(String.valueOf(entry.getKey()), serializeValue(entry.getValue(), depth + 1));
            }
            return map;
        }

        // Arrays
        if (type.isArray()) {
            List<Object> list = new ArrayList<>();
            int length = java.lang.reflect.Array.getLength(value);
            for (int i = 0; i < length; i++) {
                list.add(serializeValue(java.lang.reflect.Array.get(value, i), depth + 1));
            }
            return list;
        }

        // Complex objects - make expandable at depth
        if (depth >= 2) {
            return Map.of("_expandable", true, "_type", type.getSimpleName());
        }

        // Recursively serialize
        return serializeAsset(value);
    }
}
