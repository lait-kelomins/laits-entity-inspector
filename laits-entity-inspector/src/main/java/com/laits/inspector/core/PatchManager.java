package com.laits.inspector.core;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.hypixel.hytale.logger.HytaleLogger;
import com.laits.inspector.data.asset.PatchDraft;

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
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

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
