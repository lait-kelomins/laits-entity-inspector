package com.laits.inspector.data;

/**
 * Information about a single timer on an entity.
 */
public record TimerInfo(
    int index,
    String state,
    double value,
    double maxValue,
    double rate,
    boolean repeating
) {
    /**
     * Timer states as strings for JSON serialization.
     */
    public static final String STATE_RUNNING = "RUNNING";
    public static final String STATE_PAUSED = "PAUSED";
    public static final String STATE_STOPPED = "STOPPED";
}
