package com.laits.inspector.data;

import java.util.List;
import java.util.Map;

/**
 * Data classes for serialized NPC instruction trees.
 * These represent the runtime state of Role instructions, sensors, and actions
 * as read via reflection from live entities.
 */
public final class InstructionData {

    private InstructionData() {} // Namespace only

    /**
     * Top-level container for all instruction data from a Role.
     */
    public record InstructionTreeData(
        String roleName,
        StateMachineData stateMachine,
        Map<String, Object> parameters,
        List<InstructionNode> rootInstructions,
        List<InstructionNode> interactionInstructions,
        List<InstructionNode> deathInstructions
    ) {}

    /**
     * State machine state from StateSupport.
     */
    public record StateMachineData(
        int state,
        int subState,
        String stateName
    ) {}

    /**
     * A single instruction node in the tree.
     */
    public record InstructionNode(
        int index,
        String name,
        String tag,
        boolean continueAfter,
        boolean treeMode,
        double weight,
        SensorNode sensor,
        List<ActionNode> actions,
        List<InstructionNode> children
    ) {}

    /**
     * Sensor state snapshot. Type-specific fields are nullable.
     */
    public record SensorNode(
        String type,
        boolean once,
        boolean triggered,
        // Alarm-specific
        String alarmName,
        String alarmExpected,
        String alarmActual,
        Boolean alarmClear,
        // Timer-specific
        String timerExpectedState,
        String timerActualState,
        Double timerValue,
        Double timerMaxValue,
        Double timerMinRemaining,
        Double timerMaxRemaining,
        // Compound sensor children (And/Or/Not)
        List<SensorNode> children,
        // Generic properties extracted via reflection
        Map<String, Object> properties
    ) {
        /**
         * Create a simple sensor node (no type-specific data).
         */
        public static SensorNode simple(String type, boolean once, boolean triggered) {
            return new SensorNode(type, once, triggered,
                null, null, null, null,
                null, null, null, null, null, null,
                null, null);
        }

        /**
         * Create a sensor node with generic properties.
         */
        public static SensorNode withProperties(String type, boolean once, boolean triggered,
                                                 Map<String, Object> properties) {
            return new SensorNode(type, once, triggered,
                null, null, null, null,
                null, null, null, null, null, null,
                null, properties);
        }

        /**
         * Create an alarm sensor node.
         */
        public static SensorNode alarm(String type, boolean once, boolean triggered,
                                        String alarmName, String expected, String actual, boolean clear,
                                        Map<String, Object> properties) {
            return new SensorNode(type, once, triggered,
                alarmName, expected, actual, clear,
                null, null, null, null, null, null,
                null, properties);
        }

        /**
         * Create a timer sensor node.
         */
        public static SensorNode timer(String type, boolean once, boolean triggered,
                                        String expectedState, String actualState,
                                        double value, double maxValue,
                                        double minRemaining, double maxRemaining,
                                        Map<String, Object> properties) {
            return new SensorNode(type, once, triggered,
                null, null, null, null,
                expectedState, actualState, value, maxValue, minRemaining, maxRemaining,
                null, properties);
        }

        /**
         * Create a compound sensor node (And/Or/Not) with children.
         */
        public static SensorNode compound(String type, boolean once, boolean triggered,
                                           List<SensorNode> children,
                                           Map<String, Object> properties) {
            return new SensorNode(type, once, triggered,
                null, null, null, null,
                null, null, null, null, null, null,
                children, properties);
        }
    }

    /**
     * Action state snapshot.
     */
    public record ActionNode(
        String type,
        boolean once,
        boolean triggered,
        boolean active,
        Map<String, Object> properties
    ) {
        public static ActionNode simple(String type, boolean once, boolean triggered, boolean active) {
            return new ActionNode(type, once, triggered, active, null);
        }
        public static ActionNode withProperties(String type, boolean once, boolean triggered,
                                                 boolean active, Map<String, Object> properties) {
            return new ActionNode(type, once, triggered, active, properties);
        }
    }
}
