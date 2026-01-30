package com.laits.inspector.data;

/**
 * Information about a single alarm on an entity.
 */
public record AlarmInfo(
    String name,
    String state,
    String scheduledTime,
    Double remainingSeconds
) {
    /**
     * Alarm states as strings for JSON serialization.
     */
    public static final String STATE_SET = "SET";
    public static final String STATE_PASSED = "PASSED";
    public static final String STATE_UNSET = "UNSET";
}
