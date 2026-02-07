package com.laits.inspector.data.asset;

/**
 * Represents a single patch step in the timeline of how an asset is built up.
 *
 * @param index        Position in application order (0-based)
 * @param filename     Patch filename
 * @param sourceMod    AssetPack name that owns this patch
 * @param patchContent Raw patch JSON content
 * @param stateBefore  Full JSON state before this patch was applied
 * @param stateAfter   Full JSON state after this patch was applied
 * @param isEditable   Whether this patch is in our patch directory (can be reverted)
 */
public record PatchTimelineEntry(
    int index,
    String filename,
    String sourceMod,
    String patchContent,
    String stateBefore,
    String stateAfter,
    boolean isEditable
) {}
