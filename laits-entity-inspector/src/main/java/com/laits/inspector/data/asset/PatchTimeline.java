package com.laits.inspector.data.asset;

import java.util.List;

/**
 * Complete timeline showing how an asset is built from base + patches.
 *
 * @param baseAssetPath  The Hytalor base asset path (e.g., "Server/NPC/Roles/Creature/Cow.json")
 * @param baseAssetJson  The unpatched base asset JSON
 * @param entries        Patches in priority/application order
 * @param finalState     The fully patched asset JSON (after all patches applied)
 */
public record PatchTimeline(
    String baseAssetPath,
    String baseAssetJson,
    List<PatchTimelineEntry> entries,
    String finalState
) {}
