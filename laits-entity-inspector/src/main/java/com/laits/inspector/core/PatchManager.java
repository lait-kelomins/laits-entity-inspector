package com.laits.inspector.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.hypixel.hytale.logger.HytaleLogger;
import com.laits.inspector.data.asset.PatchDraft;
import com.laits.inspector.data.asset.PatchTimeline;
import com.laits.inspector.data.asset.PatchTimelineEntry;

import com.hypixel.hytale.assetstore.AssetPack;
import com.hypixel.hytale.server.core.asset.AssetModule;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Manages patch creation, validation, drafts, and publishing.
 */
public class PatchManager {
    private static final HytaleLogger LOGGER = HytaleLogger.forEnclosingClass();
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().setPrettyPrinting().create();

    private Path draftDirectory;
    private Path patchDirectory;

    /**
     * Initialize with directories from HytalorDetector.
     */
    public void initialize(Path draftDirectory, Path patchDirectory) {
        this.draftDirectory = draftDirectory;
        this.patchDirectory = patchDirectory;

        // Ensure directories exist
        if (draftDirectory != null) {
            ensureDirectory(draftDirectory);
        }
        if (patchDirectory != null) {
            ensureDirectory(patchDirectory);
        }
    }

    private void ensureDirectory(Path dir) {
        try {
            if (!Files.exists(dir)) {
                Files.createDirectories(dir);
            }
        } catch (IOException e) {
            LOGGER.atWarning().log("Failed to create directory %s: %s", dir, e.getMessage());
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PATCH GENERATION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Generate a patch from diff between original and modified JSON.
     *
     * Hytalor patch format (from README):
     * - BaseAssetPath: path to target asset (no .json extension)
     * - All other fields are merged into the target asset
     * - For array operations, use _index/_find/_findAll and _op INSIDE array elements
     *
     * @param baseAssetPath The asset path (e.g., "NPC/Roles/Cow")
     * @param original      Original JSON object
     * @param modified      Modified JSON object
     * @param operation     Ignored for simple patches (array ops need manual JSON)
     * @return Generated patch JSON string
     */
    public String generatePatchFromDiff(
            String baseAssetPath,
            Map<String, Object> original,
            Map<String, Object> modified,
            String operation) {

        // Calculate the diff
        Map<String, Object> diff = calculateDiff(original, modified);

        if (diff.isEmpty()) {
            return null; // No changes
        }

        // Build patch object - Hytalor format is simple:
        // { "BaseAssetPath": "...", "Field1": newValue, "Field2": newValue }
        // The _op field is only used INSIDE array elements, not at top level
        Map<String, Object> patch = new LinkedHashMap<>();
        patch.put("BaseAssetPath", baseAssetPath);

        // Add all diff fields (these get merged into the target asset)
        patch.putAll(diff);

        return GSON.toJson(patch);
    }

    /**
     * Calculate the diff between two objects.
     * Returns Hytalor-compatible patch with proper array operations.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> calculateDiff(Map<String, Object> original, Map<String, Object> modified) {
        Map<String, Object> diff = new LinkedHashMap<>();

        if (modified == null) {
            return diff;
        }

        for (Map.Entry<String, Object> entry : modified.entrySet()) {
            String key = entry.getKey();
            Object modValue = entry.getValue();
            Object origValue = original != null ? original.get(key) : null;

            // Skip if values are equal
            if (Objects.equals(origValue, modValue)) {
                continue;
            }

            // If both are maps, recurse
            if (origValue instanceof Map && modValue instanceof Map) {
                Map<String, Object> nestedDiff = calculateDiff(
                        (Map<String, Object>) origValue,
                        (Map<String, Object>) modValue
                );
                if (!nestedDiff.isEmpty()) {
                    diff.put(key, nestedDiff);
                }
            }
            // If both are lists, calculate array diff with Hytalor syntax
            else if (origValue instanceof List && modValue instanceof List) {
                List<Object> arrayDiff = calculateArrayDiff(
                        (List<Object>) origValue,
                        (List<Object>) modValue
                );
                if (!arrayDiff.isEmpty()) {
                    diff.put(key, arrayDiff);
                }
            }
            else {
                // Value changed or is new
                diff.put(key, modValue);
            }
        }

        return diff;
    }

    /**
     * Calculate diff for arrays using Hytalor's _op syntax.
     * Detects additions, modifications, and removals.
     */
    @SuppressWarnings("unchecked")
    private List<Object> calculateArrayDiff(List<Object> original, List<Object> modified) {
        List<Object> operations = new ArrayList<>();

        // Find a suitable key field for matching objects
        String keyField = findKeyField(original, modified);

        if (keyField != null) {
            // Use key-based matching
            Map<Object, Object> origByKey = indexByKey(original, keyField);
            Map<Object, Object> modByKey = indexByKey(modified, keyField);

            // Find additions (in modified but not in original)
            for (Map.Entry<Object, Object> entry : modByKey.entrySet()) {
                Object key = entry.getKey();
                Object modItem = entry.getValue();

                if (!origByKey.containsKey(key)) {
                    // New item - add with _op: add
                    if (modItem instanceof Map) {
                        Map<String, Object> addOp = new LinkedHashMap<>();
                        addOp.put("_op", "add");
                        addOp.putAll((Map<String, Object>) modItem);
                        operations.add(addOp);
                    }
                } else {
                    // Item exists in both - check for modifications
                    Object origItem = origByKey.get(key);
                    if (origItem instanceof Map && modItem instanceof Map) {
                        Map<String, Object> itemDiff = calculateDiff(
                                (Map<String, Object>) origItem,
                                (Map<String, Object>) modItem
                        );
                        if (!itemDiff.isEmpty()) {
                            // Modified item - use _find to target it
                            Map<String, Object> mergeOp = new LinkedHashMap<>();
                            Map<String, Object> findCriteria = new LinkedHashMap<>();
                            findCriteria.put(keyField, key);
                            mergeOp.put("_find", findCriteria);
                            mergeOp.putAll(itemDiff);
                            operations.add(mergeOp);
                        }
                    }
                }
            }

            // Find removals (in original but not in modified)
            for (Map.Entry<Object, Object> entry : origByKey.entrySet()) {
                Object key = entry.getKey();
                if (!modByKey.containsKey(key)) {
                    // Removed item
                    Map<String, Object> removeOp = new LinkedHashMap<>();
                    Map<String, Object> findCriteria = new LinkedHashMap<>();
                    findCriteria.put(keyField, key);
                    removeOp.put("_find", findCriteria);
                    removeOp.put("_op", "remove");
                    operations.add(removeOp);
                }
            }
        } else {
            // No key field found - use index-based comparison
            // This is less precise but works for simple arrays

            int maxLen = Math.max(original.size(), modified.size());
            for (int i = 0; i < maxLen; i++) {
                Object origItem = i < original.size() ? original.get(i) : null;
                Object modItem = i < modified.size() ? modified.get(i) : null;

                if (origItem == null && modItem != null) {
                    // New item at end
                    if (modItem instanceof Map) {
                        Map<String, Object> addOp = new LinkedHashMap<>();
                        addOp.put("_op", "add");
                        addOp.putAll((Map<String, Object>) modItem);
                        operations.add(addOp);
                    }
                } else if (origItem != null && modItem == null) {
                    // Removed item
                    Map<String, Object> removeOp = new LinkedHashMap<>();
                    removeOp.put("_index", i);
                    removeOp.put("_op", "remove");
                    operations.add(removeOp);
                } else if (!Objects.equals(origItem, modItem)) {
                    // Modified item
                    if (origItem instanceof Map && modItem instanceof Map) {
                        Map<String, Object> itemDiff = calculateDiff(
                                (Map<String, Object>) origItem,
                                (Map<String, Object>) modItem
                        );
                        if (!itemDiff.isEmpty()) {
                            Map<String, Object> mergeOp = new LinkedHashMap<>();
                            mergeOp.put("_index", i);
                            mergeOp.putAll(itemDiff);
                            operations.add(mergeOp);
                        }
                    } else {
                        // Replace primitive value
                        Map<String, Object> replaceOp = new LinkedHashMap<>();
                        replaceOp.put("_index", i);
                        replaceOp.put("_op", "replace");
                        replaceOp.put("_value", modItem);
                        operations.add(replaceOp);
                    }
                }
            }
        }

        return operations;
    }

    /**
     * Find a suitable key field for matching array elements.
     * Looks for common identifier fields like Id, ItemId, Type, Name, etc.
     */
    @SuppressWarnings("unchecked")
    private String findKeyField(List<Object> list1, List<Object> list2) {
        List<String> candidateKeys = Arrays.asList(
                "Id", "id", "ID",
                "ItemId", "itemId",
                "Type", "type",
                "Name", "name",
                "Key", "key"
        );

        // Check first items from both lists
        List<Object> combined = new ArrayList<>();
        if (!list1.isEmpty()) combined.add(list1.get(0));
        if (!list2.isEmpty()) combined.add(list2.get(0));

        for (Object item : combined) {
            if (item instanceof Map) {
                Map<String, Object> map = (Map<String, Object>) item;
                for (String candidate : candidateKeys) {
                    if (map.containsKey(candidate)) {
                        return candidate;
                    }
                }
            }
        }

        return null;
    }

    /**
     * Index a list of objects by a key field.
     */
    @SuppressWarnings("unchecked")
    private Map<Object, Object> indexByKey(List<Object> list, String keyField) {
        Map<Object, Object> indexed = new LinkedHashMap<>();
        for (Object item : list) {
            if (item instanceof Map) {
                Map<String, Object> map = (Map<String, Object>) item;
                Object key = map.get(keyField);
                if (key != null) {
                    indexed.put(key, item);
                }
            }
        }
        return indexed;
    }

    // ═══════════════════════════════════════════════════════════════
    // VALIDATION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Validate a patch JSON string.
     *
     * Hytalor patch requirements:
     * - Must have "BaseAssetPath" field (no .json extension)
     * - All other fields are merged into target asset
     * - Array operations use _op/_index/_find INSIDE array elements
     *
     * @param patchJson The patch JSON to validate
     * @return null if valid, error message if invalid
     */
    public String validatePatch(String patchJson) {
        if (patchJson == null || patchJson.trim().isEmpty()) {
            return "Patch JSON is empty";
        }

        try {
            JsonElement element = JsonParser.parseString(patchJson);

            if (!element.isJsonObject()) {
                return "Patch must be a JSON object";
            }

            JsonObject obj = element.getAsJsonObject();

            // Check required field
            if (!obj.has("BaseAssetPath")) {
                return "Missing required field: BaseAssetPath";
            }

            String basePath = obj.get("BaseAssetPath").getAsString();
            if (basePath.isEmpty()) {
                return "BaseAssetPath cannot be empty";
            }

            // Warn if BaseAssetPath has .json extension (Hytalor doesn't expect it)
            if (basePath.endsWith(".json")) {
                return "BaseAssetPath should not have .json extension";
            }

            return null; // Valid

        } catch (Exception e) {
            return "Invalid JSON: " + e.getMessage();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // DRAFT MANAGEMENT
    // ═══════════════════════════════════════════════════════════════

    /**
     * Save a draft patch file.
     */
    public void saveDraft(String filename, String patchJson) throws IOException {
        if (draftDirectory == null) {
            throw new IOException("Draft directory not configured");
        }

        // Sanitize filename
        String safeFilename = sanitizeFilename(filename);
        if (!safeFilename.endsWith(".json")) {
            safeFilename += ".json";
        }

        Path draftPath = draftDirectory.resolve(safeFilename);
        Files.writeString(draftPath, patchJson, StandardCharsets.UTF_8);

        LOGGER.atInfo().log("Saved draft: %s", draftPath);
    }

    /**
     * List all saved drafts.
     */
    public List<PatchDraft> listDrafts() {
        if (draftDirectory == null || !Files.exists(draftDirectory)) {
            return Collections.emptyList();
        }

        try (Stream<Path> files = Files.list(draftDirectory)) {
            return files
                    .filter(f -> f.toString().endsWith(".json"))
                    .map(this::loadDraft)
                    .filter(Objects::nonNull)
                    .sorted(Comparator.comparing(PatchDraft::getCreatedAt).reversed())
                    .collect(Collectors.toList());
        } catch (IOException e) {
            LOGGER.atWarning().log("Failed to list drafts: %s", e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Load a draft from file.
     */
    private PatchDraft loadDraft(Path path) {
        try {
            String content = Files.readString(path, StandardCharsets.UTF_8);
            JsonObject obj = JsonParser.parseString(content).getAsJsonObject();

            String baseAssetPath = obj.has("BaseAssetPath")
                    ? obj.get("BaseAssetPath").getAsString()
                    : "unknown";

            return PatchDraft.builder()
                    .filename(path.getFileName().toString())
                    .baseAssetPath(baseAssetPath)
                    .content(content)
                    .createdAt(Instant.ofEpochMilli(path.toFile().lastModified()))
                    .build();

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to load draft %s: %s", path, e.getMessage());
            return null;
        }
    }

    /**
     * Delete a draft file.
     */
    public void deleteDraft(String filename) throws IOException {
        if (draftDirectory == null) {
            throw new IOException("Draft directory not configured");
        }

        String safeFilename = sanitizeFilename(filename);
        Path draftPath = draftDirectory.resolve(safeFilename);

        if (Files.exists(draftPath)) {
            Files.delete(draftPath);
            LOGGER.atInfo().log("Deleted draft: %s", draftPath);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PUBLISHING
    // ═══════════════════════════════════════════════════════════════

    /**
     * Publish a patch to the Server/Patch/ directory.
     */
    public void publishPatch(String filename, String patchJson) throws IOException {
        if (patchDirectory == null) {
            throw new IOException("Patch directory not configured (is Hytalor installed?)");
        }

        // Validate first
        String error = validatePatch(patchJson);
        if (error != null) {
            throw new IOException("Invalid patch: " + error);
        }

        // Sanitize filename
        String safeFilename = sanitizeFilename(filename);
        if (!safeFilename.endsWith(".json")) {
            safeFilename += ".json";
        }

        Path patchPath = patchDirectory.resolve(safeFilename);
        Files.writeString(patchPath, patchJson, StandardCharsets.UTF_8);

        LOGGER.atInfo().log("Published patch to: %s (absolute: %s)", patchPath, patchPath.toAbsolutePath());
    }

    /**
     * Delete a published patch.
     */
    public void deletePatch(String filename) throws IOException {
        if (patchDirectory == null) {
            throw new IOException("Patch directory not configured (is Hytalor installed?)");
        }

        String safeFilename = sanitizeFilename(filename);
        if (!safeFilename.endsWith(".json")) {
            safeFilename += ".json";
        }

        Path patchPath = patchDirectory.resolve(safeFilename);

        if (!Files.exists(patchPath)) {
            throw new IOException("Patch file not found: " + safeFilename);
        }

        Files.delete(patchPath);
        LOGGER.atInfo().log("Deleted patch: %s", patchPath);
    }

    /**
     * List all published patches in the patch directory.
     */
    public List<String> listPublishedPatches() {
        if (patchDirectory == null || !Files.exists(patchDirectory)) {
            return java.util.Collections.emptyList();
        }

        try (var stream = Files.list(patchDirectory)) {
            return stream
                    .filter(p -> p.toString().endsWith(".json"))
                    .map(p -> p.getFileName().toString())
                    .sorted()
                    .toList();
        } catch (IOException e) {
            LOGGER.atWarning().log("Failed to list patches: %s", e.getMessage());
            return java.util.Collections.emptyList();
        }
    }

    /**
     * Info about a published patch including its content.
     */
    public record PatchInfo(String filename, String content, long modifiedTime) {}

    /**
     * Info about a patch from any mod, including whether it's editable.
     */
    public record ExternalPatchInfo(
        String filename,
        String content,
        long modifiedTime,
        String sourceMod,
        boolean isEditable
    ) {}

    /**
     * List all published patches with their content.
     * Used to populate history on client connection.
     */
    public List<PatchInfo> listPublishedPatchesWithContent() {
        if (patchDirectory == null || !Files.exists(patchDirectory)) {
            return java.util.Collections.emptyList();
        }

        try (var stream = Files.list(patchDirectory)) {
            return stream
                    .filter(p -> p.toString().endsWith(".json"))
                    .sorted()
                    .map(p -> {
                        try {
                            String content = Files.readString(p, StandardCharsets.UTF_8);
                            long modifiedTime = Files.getLastModifiedTime(p).toMillis();
                            return new PatchInfo(p.getFileName().toString(), content, modifiedTime);
                        } catch (IOException e) {
                            LOGGER.atWarning().log("Failed to read patch %s: %s", p.getFileName(), e.getMessage());
                            return null;
                        }
                    })
                    .filter(Objects::nonNull)
                    .toList();
        } catch (IOException e) {
            LOGGER.atWarning().log("Failed to list patches: %s", e.getMessage());
            return java.util.Collections.emptyList();
        }
    }

    /**
     * List all patches across all asset packs, including other mods.
     * Patches from our mod are marked as editable, others as readonly.
     */
    public List<ExternalPatchInfo> listAllPatchesAcrossMods() {
        List<ExternalPatchInfo> allPatches = new ArrayList<>();

        try {
            List<AssetPack> packs = AssetModule.get().getAssetPacks();

            for (AssetPack pack : packs) {
                Path patchDir = pack.getRoot().resolve("Server").resolve("Patch");
                if (!Files.exists(patchDir)) {
                    continue;
                }

                // Check if this is our own asset pack (the one we can edit)
                boolean isOurPack = patchDirectory != null &&
                    patchDir.toAbsolutePath().equals(patchDirectory.toAbsolutePath());

                try (Stream<Path> files = Files.list(patchDir)) {
                    files.filter(p -> p.toString().endsWith(".json"))
                        .forEach(p -> {
                            try {
                                String content = Files.readString(p, StandardCharsets.UTF_8);
                                long modifiedTime = Files.getLastModifiedTime(p).toMillis();
                                allPatches.add(new ExternalPatchInfo(
                                    p.getFileName().toString(),
                                    content,
                                    modifiedTime,
                                    pack.getName(),
                                    isOurPack
                                ));
                            } catch (IOException e) {
                                LOGGER.atWarning().log("Failed to read patch %s from %s: %s",
                                    p.getFileName(), pack.getName(), e.getMessage());
                            }
                        });
                } catch (IOException e) {
                    LOGGER.atWarning().log("Failed to list patches in %s: %s",
                        pack.getName(), e.getMessage());
                }
            }
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to list patches across mods: %s", e.getMessage());
        }

        // Sort by modification time, newest first
        allPatches.sort((a, b) -> Long.compare(b.modifiedTime(), a.modifiedTime()));

        return allPatches;
    }

    // ═══════════════════════════════════════════════════════════════
    // PATCH TIMELINE & PREVIEW (requires Hytalor 2.2+)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Build a full timeline showing how an asset is constructed from base + patches.
     * Uses Hytalor's PatchManager API and JSONUtil.deepMerge() for accurate previews.
     *
     * @param assetId        The inspector asset ID (e.g., "NPC/Roles/Creature/Cow")
     * @param assetCollector The AssetCollector for path resolution
     * @return PatchTimeline, or null if asset not found or Hytalor unavailable
     */
    public PatchTimeline getAssetPatchTimeline(String assetId, AssetCollector assetCollector) {
        try {
            // Resolve to Hytalor path
            String hytalorPath = assetCollector.resolveHytalorBasePath(assetId);
            if (hytalorPath == null) {
                LOGGER.atWarning().log("Cannot resolve asset ID to Hytalor path: %s", assetId);
                return null;
            }

            // Get Hytalor's PatchManager via reflection (compiled with newer Java version)
            Object hytalorPm = getHytalorPatchManager();
            if (hytalorPm == null) {
                LOGGER.atWarning().log("Hytalor PatchManager not available");
                return null;
            }

            // Get the unpatched base asset - returns List<Map.Entry<String, Path>>
            @SuppressWarnings("unchecked")
            List<Map.Entry<String, Path>> baseEntries = (List<Map.Entry<String, Path>>)
                hytalorPm.getClass().getMethod("getBaseAssets", String.class).invoke(hytalorPm, hytalorPath);
            if (baseEntries == null || baseEntries.isEmpty()) {
                LOGGER.atWarning().log("Base asset not found for: %s", hytalorPath);
                return null;
            }

            // Use the first matching base asset
            Path baseAssetFile = baseEntries.get(0).getValue();
            if (!Files.exists(baseAssetFile)) {
                LOGGER.atWarning().log("Base asset file does not exist: %s", baseAssetFile);
                return null;
            }

            JsonObject baseJson = readJsonFromPath(baseAssetFile);
            if (baseJson == null) {
                LOGGER.atWarning().log("Failed to parse base asset JSON for: %s", hytalorPath);
                return null;
            }
            String baseAssetJson = GSON.toJson(baseJson);

            // Get ordered patches - returns List<PatchObject> where PatchObject has patch() and path()
            // Hytalor's getPatches throws NPE internally when no patches exist, so handle gracefully
            List<Object> patchObjects;
            try {
                @SuppressWarnings("unchecked")
                List<Object> result = (List<Object>)
                    hytalorPm.getClass().getMethod("getPatches", String.class).invoke(hytalorPm, hytalorPath);
                patchObjects = result != null ? result : Collections.emptyList();
            } catch (java.lang.reflect.InvocationTargetException e) {
                // Hytalor throws when no patches exist - treat as empty
                patchObjects = Collections.emptyList();
            }

            // Build timeline by iteratively applying each patch
            List<PatchTimelineEntry> entries = new ArrayList<>();
            JsonObject currentState = deepCopy(baseJson);

            for (int i = 0; i < patchObjects.size(); i++) {
                Object patchObj = patchObjects.get(i);
                // PatchObject is a record with patch() and path() accessors
                JsonObject patchJson = (JsonObject) patchObj.getClass().getMethod("patch").invoke(patchObj);
                Path patchFile = (Path) patchObj.getClass().getMethod("path").invoke(patchObj);

                if (patchJson == null) {
                    LOGGER.atWarning().log("Null patch JSON from: %s", patchFile);
                    continue;
                }

                String stateBefore = GSON.toJson(currentState);
                String patchContent = GSON.toJson(patchJson);

                // Strip metadata before merging
                JsonObject patchForMerge = deepCopy(patchJson);
                stripPatchMetadata(patchForMerge);

                // Apply patch via deepMerge (mutates target in-place, so work on a copy)
                JsonObject stateAfterMerge = deepCopy(currentState);
                invokeDeepMerge(patchForMerge, stateAfterMerge);

                String stateAfter = GSON.toJson(stateAfterMerge);
                String sourceMod = determineSourceMod(patchFile);
                boolean editable = isInOurPatchDirectory(patchFile);

                entries.add(new PatchTimelineEntry(
                    i,
                    patchFile.getFileName().toString(),
                    sourceMod,
                    patchContent,
                    stateBefore,
                    stateAfter,
                    editable
                ));

                // Update current state for next iteration
                currentState = stateAfterMerge;
            }

            String finalState = GSON.toJson(currentState);

            return new PatchTimeline(hytalorPath, baseAssetJson, entries, finalState);

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to build patch timeline for %s: %s", assetId, e.getMessage());
            return null;
        }
    }

    /**
     * Fetch the unpatched base asset JSON for an asset ID.
     * Reuses the same Hytalor resolution logic as getAssetPatchTimeline.
     */
    private JsonObject getBaseAssetJson(String assetId, AssetCollector assetCollector) {
        try {
            String hytalorPath = assetCollector.resolveHytalorBasePath(assetId);
            if (hytalorPath == null) return null;

            Object hytalorPm = getHytalorPatchManager();
            if (hytalorPm == null) return null;

            @SuppressWarnings("unchecked")
            List<Map.Entry<String, Path>> baseEntries = (List<Map.Entry<String, Path>>)
                hytalorPm.getClass().getMethod("getBaseAssets", String.class).invoke(hytalorPm, hytalorPath);
            if (baseEntries == null || baseEntries.isEmpty()) return null;

            Path baseAssetFile = baseEntries.get(0).getValue();
            if (!Files.exists(baseAssetFile)) return null;

            return readJsonFromPath(baseAssetFile);
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to get base asset JSON for %s: %s", assetId, e.getMessage());
            return null;
        }
    }

    /**
     * Compute the merged state of an asset after applying all existing patches PLUS a new patch.
     *
     * @param assetId        The inspector asset ID
     * @param patchJson      The new patch JSON to preview
     * @param assetCollector The AssetCollector for path resolution
     * @return The merged JSON string, or null on error
     */
    public String computeMergePreview(String assetId, String patchJson, AssetCollector assetCollector) {
        try {
            // Try timeline first (includes all existing patches applied)
            PatchTimeline timeline = getAssetPatchTimeline(assetId, assetCollector);

            JsonObject stateCopy;
            if (timeline != null) {
                stateCopy = deepCopy(JsonParser.parseString(timeline.finalState()).getAsJsonObject());
            } else {
                // No existing patches - fall back to base asset directly
                stateCopy = getBaseAssetJson(assetId, assetCollector);
                if (stateCopy == null) {
                    LOGGER.atWarning().log("Cannot resolve base asset for merge preview: %s", assetId);
                    return null;
                }
            }

            JsonObject newPatch = JsonParser.parseString(patchJson).getAsJsonObject();
            JsonObject patchForMerge = deepCopy(newPatch);
            stripPatchMetadata(patchForMerge);

            // Apply the new patch on top
            invokeDeepMerge(patchForMerge, stateCopy);

            return GSON.toJson(stateCopy);

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to compute merge preview for %s: %s", assetId, e.getMessage());
            return null;
        }
    }

    /**
     * Compute what the asset would look like if a specific patch were removed.
     *
     * @param assetId        The inspector asset ID
     * @param patchFilename  The filename of the patch to exclude
     * @param assetCollector The AssetCollector for path resolution
     * @return The reverted JSON string, or null on error
     */
    public String computeRevertPreview(String assetId, String patchFilename, AssetCollector assetCollector) {
        try {
            String hytalorPath = assetCollector.resolveHytalorBasePath(assetId);
            if (hytalorPath == null) return null;

            Object hytalorPm = getHytalorPatchManager();
            if (hytalorPm == null) return null;

            @SuppressWarnings("unchecked")
            List<Map.Entry<String, Path>> baseEntries = (List<Map.Entry<String, Path>>)
                hytalorPm.getClass().getMethod("getBaseAssets", String.class).invoke(hytalorPm, hytalorPath);
            if (baseEntries == null || baseEntries.isEmpty()) return null;

            Path baseAssetFile = baseEntries.get(0).getValue();
            if (!Files.exists(baseAssetFile)) return null;

            JsonObject baseJson = readJsonFromPath(baseAssetFile);
            if (baseJson == null) return null;

            @SuppressWarnings("unchecked")
            List<Object> patchObjects = (List<Object>)
                hytalorPm.getClass().getMethod("getPatches", String.class).invoke(hytalorPm, hytalorPath);
            if (patchObjects == null) patchObjects = Collections.emptyList();

            // Apply all patches EXCEPT the one with matching filename
            JsonObject currentState = deepCopy(baseJson);
            for (Object patchObj : patchObjects) {
                Path patchPath = (Path) patchObj.getClass().getMethod("path").invoke(patchObj);
                if (patchPath.getFileName().toString().equals(patchFilename)) {
                    continue; // Skip the target patch
                }

                JsonObject patchJson = (JsonObject) patchObj.getClass().getMethod("patch").invoke(patchObj);
                if (patchJson == null) continue;

                JsonObject patchForMerge = deepCopy(patchJson);
                stripPatchMetadata(patchForMerge);

                invokeDeepMerge(patchForMerge, currentState);
            }

            return GSON.toJson(currentState);

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to compute revert preview for %s (excluding %s): %s",
                assetId, patchFilename, e.getMessage());
            return null;
        }
    }

    /**
     * Get Hytalor's PatchManager singleton via reflection.
     * Hytalor is compiled with a newer Java version, so we must use reflection.
     */
    private Object getHytalorPatchManager() {
        try {
            Class<?> pmClass = Class.forName("com.hypersonicsharkz.PatchManager");
            return pmClass.getMethod("get").invoke(null);
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to get Hytalor PatchManager: %s", e.getMessage());
            return null;
        }
    }

    /**
     * Invoke JSONUtil.deepMerge via reflection.
     */
    private void invokeDeepMerge(JsonObject source, JsonObject target) {
        try {
            Class<?> utilClass = Class.forName("com.hypersonicsharkz.util.JSONUtil");
            utilClass.getMethod("deepMerge", JsonObject.class, JsonObject.class).invoke(null, source, target);
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to invoke JSONUtil.deepMerge: %s", e.getMessage());
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // TIMELINE HELPERS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Read a JSON file to a JsonObject.
     */
    private JsonObject readJsonFromPath(Path path) {
        try {
            String content = Files.readString(path, StandardCharsets.UTF_8);
            return JsonParser.parseString(content).getAsJsonObject();
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to read JSON from %s: %s", path, e.getMessage());
            return null;
        }
    }

    /**
     * Deep copy a JsonObject to prevent mutation.
     */
    private JsonObject deepCopy(JsonObject original) {
        return JsonParser.parseString(original.toString()).getAsJsonObject();
    }

    /**
     * Determine which mod/asset pack owns a patch file.
     */
    private String determineSourceMod(Path patchFile) {
        try {
            List<AssetPack> packs = AssetModule.get().getAssetPacks();
            String patchAbsolute = patchFile.toAbsolutePath().toString().replace('\\', '/');

            for (AssetPack pack : packs) {
                String packRoot = pack.getRoot().toAbsolutePath().toString().replace('\\', '/');
                if (patchAbsolute.startsWith(packRoot)) {
                    return pack.getName();
                }
            }
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to determine source mod for %s: %s", patchFile, e.getMessage());
        }
        return "Unknown";
    }

    /**
     * Check if a patch file is in our editable patch directory.
     */
    private boolean isInOurPatchDirectory(Path patchFile) {
        if (patchDirectory == null) return false;
        try {
            String patchAbsolute = patchFile.toAbsolutePath().toString().replace('\\', '/');
            String ourDir = patchDirectory.toAbsolutePath().toString().replace('\\', '/');
            return patchAbsolute.startsWith(ourDir);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Strip patch metadata keys that shouldn't be merged into the asset.
     */
    private void stripPatchMetadata(JsonObject patch) {
        patch.remove("BaseAssetPath");
        patch.remove("_BaseAssetPath");
        patch.remove("_priority");
        patch.remove("$Comment");
    }

    // ═══════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Sanitize a filename to prevent path traversal attacks.
     */
    private String sanitizeFilename(String filename) {
        if (filename == null) {
            return "patch_" + System.currentTimeMillis();
        }

        // Remove path separators and dangerous characters
        return filename
                .replaceAll("[/\\\\:*?\"<>|]", "_")
                .replaceAll("\\.\\.", "_")
                .trim();
    }

    /**
     * Check if the manager is ready for patch operations.
     */
    public boolean isReady() {
        return patchDirectory != null;
    }
}
