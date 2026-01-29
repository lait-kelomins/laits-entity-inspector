package com.laits.inspector.core;

import com.hypixel.hytale.assetstore.AssetPack;
import com.hypixel.hytale.common.plugin.PluginManifest;
import com.hypixel.hytale.common.semver.Semver;
import com.hypixel.hytale.logger.HytaleLogger;
import com.hypixel.hytale.server.core.HytaleServer;
import com.hypixel.hytale.server.core.asset.AssetModule;
import com.hypixel.hytale.server.core.plugin.PluginBase;
import com.hypixel.hytale.server.core.plugin.PluginManager;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

/**
 * Detects whether Hytalor is present via Plugin Registry.
 * Provides paths for patch and draft directories.
 *
 * IMPORTANT: Hytalor loads patches from Server/Patch/ directories WITHIN each asset pack,
 * not from a global Server/Patch/ directory. We need to find a suitable asset pack to save patches to.
 */
public class HytalorDetector {
    private static final HytaleLogger LOGGER = HytaleLogger.forEnclosingClass();

    private boolean hytalorPresent = false;
    private Path patchDirectory;
    private Path draftDirectory;
    private String patchAssetPackName;

    /**
     * Detect Hytalor plugin presence and find suitable patch directory.
     */
    public void detect() {
        hytalorPresent = false;
        patchDirectory = null;
        draftDirectory = null;
        patchAssetPackName = null;

        try {
            PluginManager pm = HytaleServer.get().getPluginManager();
            if (pm == null) {
                LOGGER.atInfo().log("PluginManager not available");
                return;
            }

            // Search for Hytalor plugin
            for (PluginBase plugin : pm.getPlugins()) {
                String name = plugin.getName();
                if (name != null && name.toLowerCase().contains("hytalor")) {
                    hytalorPresent = true;
                    LOGGER.atInfo().log("Hytalor plugin detected: %s", name);
                    break;
                }
            }

            // Set up directories
            if (hytalorPresent) {
                // Find a suitable asset pack for saving patches
                // Hytalor loads patches from <AssetPack>/Server/Patch/ for each registered pack
                patchDirectory = findPatchDirectory();

                if (patchDirectory == null) {
                    LOGGER.atInfo().log("No suitable asset pack found. Creating InspectorPatches asset pack...");
                    // Create and register our own asset pack for patches
                    patchDirectory = createAndRegisterInspectorPatchesPack();
                    if (patchDirectory != null) {
                        patchAssetPackName = "com.laits:InspectorPatches";
                    }
                }

                // Draft directory: inspector/drafts/ (relative to server root)
                draftDirectory = Paths.get("inspector", "drafts");

                // Ensure directories exist
                ensureDirectory(patchDirectory);
                ensureDirectory(draftDirectory);

                LOGGER.atInfo().log("Patch directory: %s (absolute: %s)",
                        patchDirectory, patchDirectory.toAbsolutePath());
            }

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to detect Hytalor: %s", e.getMessage());
        }

        LOGGER.atInfo().log("Hytalor detection complete: %s, patch pack: %s",
                hytalorPresent ? "ENABLED" : "DISABLED",
                patchAssetPackName != null ? patchAssetPackName : "none");
    }

    /**
     * Find a suitable asset pack's Server/Patch directory.
     * Prefers non-immutable packs, especially Hytalor's own pack or other mod packs.
     */
    private Path findPatchDirectory() {
        try {
            List<AssetPack> packs = AssetModule.get().getAssetPacks();

            // First pass: look for Hytalor's pack or inspector pack
            for (AssetPack pack : packs) {
                String name = pack.getName().toLowerCase();
                if ((name.contains("hytalor") || name.contains("inspector"))
                        && !pack.isImmutable()
                        && !name.contains("overrides")) {  // Skip Hytalor-Overrides temp pack
                    Path patchPath = pack.getRoot().resolve("Server").resolve("Patch");
                    patchAssetPackName = pack.getName();
                    LOGGER.atInfo().log("Using asset pack for patches: %s", pack.getName());
                    return patchPath;
                }
            }

            // Second pass: look for any non-immutable, non-base pack
            for (AssetPack pack : packs) {
                if (!pack.isImmutable() && !pack.getName().contains("Hytale")) {
                    Path patchPath = pack.getRoot().resolve("Server").resolve("Patch");
                    patchAssetPackName = pack.getName();
                    LOGGER.atInfo().log("Using asset pack for patches: %s", pack.getName());
                    return patchPath;
                }
            }

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to find patch directory: %s", e.getMessage());
        }

        return null;
    }

    /**
     * Create and register the InspectorPatches asset pack.
     * This allows Hytalor to find and load patches from our directory.
     */
    private Path createAndRegisterInspectorPatchesPack() {
        try {
            Path packRoot = PluginManager.MODS_PATH.resolve("InspectorPatches");
            Path patchDir = packRoot.resolve("Server").resolve("Patch");

            // Ensure directories exist
            if (!Files.exists(patchDir)) {
                Files.createDirectories(patchDir);
            }

            // Create manifest for the asset pack
            PluginManifest manifest = new PluginManifest(
                    "com.laits",
                    "InspectorPatches",
                    Semver.fromString("1.0.0"),
                    "Asset pack for Entity Inspector patches",
                    new ArrayList<>(),  // authors
                    "",                 // website
                    null,               // serverVersion
                    null,               // source
                    new HashMap<>(),    // dependencies
                    new HashMap<>(),    // optionalDependencies
                    new HashMap<>(),    // conflicts
                    new ArrayList<>(),  // subPlugins
                    false               // disabledByDefault
            );

            // Register the asset pack with AssetModule
            AssetModule.get().registerPack(
                    "com.laits:InspectorPatches",
                    packRoot,
                    manifest
            );

            LOGGER.atInfo().log("Registered InspectorPatches asset pack at: %s", packRoot.toAbsolutePath());

            return patchDir;

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to create InspectorPatches asset pack: %s", e.getMessage());
            return null;
        }
    }

    /**
     * Ensure a directory exists.
     */
    private void ensureDirectory(Path dir) {
        try {
            if (!dir.toFile().exists()) {
                dir.toFile().mkdirs();
            }
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to create directory %s: %s", dir, e.getMessage());
        }
    }

    /**
     * Check if Hytalor is present.
     */
    public boolean isHytalorPresent() {
        return hytalorPresent;
    }

    /**
     * Get the patch directory (Server/Patch/).
     */
    public Path getPatchDirectory() {
        return patchDirectory;
    }

    /**
     * Get the draft directory (inspector/drafts/).
     */
    public Path getDraftDirectory() {
        return draftDirectory;
    }

    /**
     * Get patch directory as string for client.
     */
    public String getPatchDirectoryString() {
        return patchDirectory != null ? patchDirectory.toString() : null;
    }

    /**
     * Get draft directory as string for client.
     */
    public String getDraftDirectoryString() {
        return draftDirectory != null ? draftDirectory.toString() : null;
    }

    /**
     * Get the name of the asset pack being used for patches.
     */
    public String getPatchAssetPackName() {
        return patchAssetPackName;
    }
}
