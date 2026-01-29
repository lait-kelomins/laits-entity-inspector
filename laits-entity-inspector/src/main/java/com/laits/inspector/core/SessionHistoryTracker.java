package com.laits.inspector.core;

import com.laits.inspector.data.asset.HistoryEntry;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Tracks patch creation history for the current session.
 * History is cleared on server restart.
 */
public class SessionHistoryTracker {

    private static final int MAX_HISTORY_SIZE = 100;

    private final List<HistoryEntry> entries = new CopyOnWriteArrayList<>();

    /**
     * Record a new patch in the history.
     *
     * @param filename      The patch filename
     * @param baseAssetPath The base asset path
     * @param operation     The operation type (draft, publish)
     */
    public void recordPatch(String filename, String baseAssetPath, String operation) {
        HistoryEntry entry = HistoryEntry.builder()
                .filename(filename)
                .baseAssetPath(baseAssetPath)
                .timestamp(Instant.now())
                .operation(operation)
                .build();

        entries.add(0, entry); // Add at beginning (most recent first)

        // Trim to max size
        while (entries.size() > MAX_HISTORY_SIZE) {
            entries.remove(entries.size() - 1);
        }
    }

    /**
     * Get all history entries.
     * Most recent entries are first.
     */
    public List<HistoryEntry> getHistory() {
        return Collections.unmodifiableList(new ArrayList<>(entries));
    }

    /**
     * Get recent history entries.
     *
     * @param limit Maximum number of entries to return
     */
    public List<HistoryEntry> getRecentHistory(int limit) {
        List<HistoryEntry> result = new ArrayList<>();
        int count = Math.min(limit, entries.size());
        for (int i = 0; i < count; i++) {
            result.add(entries.get(i));
        }
        return result;
    }

    /**
     * Clear all history.
     */
    public void clear() {
        entries.clear();
    }

    /**
     * Get total number of entries.
     */
    public int size() {
        return entries.size();
    }
}
