package com.laits.inspector.core;

import com.hypixel.hytale.logger.HytaleLogger;
import com.hypixel.hytale.server.npc.entities.NPCEntity;
import com.hypixel.hytale.server.npc.instructions.Instruction;
import com.hypixel.hytale.server.npc.role.Role;
import com.hypixel.hytale.server.npc.role.support.StateSupport;
import com.laits.inspector.data.InstructionData;
import com.laits.inspector.data.InstructionData.*;

import java.lang.reflect.Field;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Reflection-based serializer for NPC instruction trees.
 * Reads live state from Role, Instruction, Sensor, and Action objects
 * WITHOUT calling any evaluation methods (to avoid side effects like Clear:true).
 *
 * <p>All access is read-only via field reflection. Getters are used where available
 * (e.g., Role.getRootInstruction()), reflection only for internal state fields.</p>
 */
public class InstructionSerializer {
    private static final HytaleLogger LOGGER = HytaleLogger.forEnclosingClass();

    // Field reflection cache (class -> fieldName -> Field)
    private final Map<String, Field> fieldCache = new ConcurrentHashMap<>();

    // Fields to skip in generic sensor property extraction.
    // Organized by category so new fields can be added to the right group.
    private static final Set<String> SKIP_FIELDS = Set.of(
        // ── Base fields (already captured in SensorNode) ──
        "once", "triggered",
        // ── Dedicated serializers handle these ──
        "alarm", "timer", "sensor", "sensors",
        // ── Complex internal objects (providers, component types, non-serializable) ──
        "infoProvider", "positionProvider", "pathProvider",
        "prioritiser", "npcPrioritiser", "playerPrioritiser",
        "collector", "filters", "lightRangePredicate",
        "compileContext", "instructions",
        "multipleParameterProvider", "parameterProvider",
        "minRangeParameterProvider", "maxRangeParameterProvider",
        "positioningAngleParameterProvider",
        "stringParameterProviders", "intParameterProviders", "doubleParameterProviders",
        "valueStoreComponentType", "patrolPathMarkerEntityComponentType",
        "worldGenIdComponentType", "prefabPathSpatialResource",
        // ── Mutable internal state (noisy, changes every tick) ──
        "remainingDuration", "heading", "cachedResult", "cachedPosition",
        "delay", "lastCheckedPosition", "lastCheckedYaw", "lastBlockRevision",
        "throttleTimeRemaining", "distanceSquared", "loadStatus",
        "pathIndex", "pathChangeRevision", "prevWeatherIndex"
    );

    // Fields to skip in generic action property extraction.
    private static final Set<String> ACTION_SKIP_FIELDS = Set.of(
        // ── Base fields (already captured in ActionNode) ──
        "once", "triggered", "active",
        // ── Complex internal objects (providers, component types, non-serializable) ──
        "infoProvider", "positionProvider", "pathProvider",
        "prioritiser", "npcPrioritiser", "playerPrioritiser",
        "collector", "filters", "lightRangePredicate",
        "compileContext", "instructions",
        "multipleParameterProvider", "parameterProvider",
        "minRangeParameterProvider", "maxRangeParameterProvider",
        "positioningAngleParameterProvider",
        "stringParameterProviders", "intParameterProviders", "doubleParameterProviders",
        "valueStoreComponentType", "patrolPathMarkerEntityComponentType",
        "worldGenIdComponentType", "prefabPathSpatialResource",
        "targetComponentType", "sourceComponentType", "componentType",
        "alarmParameter", "timerParameter",
        // ── Mutable internal state (noisy, changes every tick) ──
        "remainingDuration", "cachedResult", "cachedPosition",
        "delay", "throttleTimeRemaining", "lastTriggerTime"
    );

    // Types safe to serialize directly
    private static final Set<Class<?>> SERIALIZABLE_TYPES = Set.of(
        boolean.class, Boolean.class,
        int.class, Integer.class,
        long.class, Long.class,
        float.class, Float.class,
        double.class, Double.class,
        String.class
    );

    /**
     * Serialize the full instruction tree from an NPCEntity.
     *
     * @param npcEntity The live NPCEntity component
     * @param gameTime  Current game time for alarm state calculation, or null
     * @return Serialized instruction tree, or null on failure
     */
    public InstructionTreeData serialize(NPCEntity npcEntity, Instant gameTime) {
        if (npcEntity == null) {
            return null;
        }

        try {
            Role role = npcEntity.getRole();
            if (role == null) {
                return null;
            }

            String roleName = role.getRoleName();

            // State machine
            StateSupport stateSupport = role.getStateSupport();
            StateMachineData stateMachine = serializeStateMachine(stateSupport);

            // Instruction trees
            List<InstructionNode> rootInstructions = serializeInstructionTree(
                role.getRootInstruction(), gameTime);
            List<InstructionNode> interactionInstructions = serializeInstructionTree(
                role.getInteractionInstruction(), gameTime);
            List<InstructionNode> deathInstructions = serializeInstructionTree(
                role.getDeathInstruction(), gameTime);

            return new InstructionTreeData(
                roleName,
                stateMachine,
                Collections.emptyMap(), // Parameters - future enhancement
                rootInstructions,
                interactionInstructions,
                deathInstructions
            );

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to serialize instructions: %s", e.getMessage());
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // STATE MACHINE
    // ═══════════════════════════════════════════════════════════════

    private StateMachineData serializeStateMachine(StateSupport stateSupport) {
        if (stateSupport == null) {
            return new StateMachineData(0, 0, "unknown");
        }

        try {
            int state = stateSupport.getStateIndex();
            int subState = stateSupport.getSubStateIndex();
            String stateName = stateSupport.getStateName();
            return new StateMachineData(state, subState, stateName);
        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to read state machine: %s", e.getMessage());
            return new StateMachineData(0, 0, "error");
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // INSTRUCTION TREE
    // ═══════════════════════════════════════════════════════════════

    /**
     * Serialize an instruction tree starting from the root/interaction/death instruction.
     * The root instruction itself contains child instructions in its instructionList.
     */
    private List<InstructionNode> serializeInstructionTree(Instruction instruction, Instant gameTime) {
        if (instruction == null) {
            return Collections.emptyList();
        }

        try {
            // The root/interaction/death instruction is a wrapper that contains
            // the actual instruction list as children
            Instruction[] children = getInstructionList(instruction);
            if (children == null || children.length == 0) {
                return Collections.emptyList();
            }

            List<InstructionNode> nodes = new ArrayList<>(children.length);
            for (int i = 0; i < children.length; i++) {
                InstructionNode node = serializeInstruction(children[i], i, gameTime);
                if (node != null) {
                    nodes.add(node);
                }
            }
            return nodes;

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to serialize instruction tree: %s", e.getMessage());
            return Collections.emptyList();
        }
    }

    /**
     * Serialize a single instruction node recursively.
     */
    private InstructionNode serializeInstruction(Instruction instruction, int index, Instant gameTime) {
        if (instruction == null) {
            return null;
        }

        try {
            // Read instruction fields
            String name = getFieldValue(instruction, "name", String.class);
            String tag = getFieldValue(instruction, "tag", String.class);
            boolean continueAfter = instruction.isContinueAfter();
            boolean treeMode = getFieldValue(instruction, "treeMode", Boolean.class, false);
            double weight = instruction.getWeight();

            // Sensor
            Object sensorObj = instruction.getSensor();
            SensorNode sensor = serializeSensor(sensorObj, gameTime);

            // Actions
            List<ActionNode> actions = serializeActions(instruction);

            // Child instructions (recursive)
            Instruction[] childArray = getInstructionList(instruction);
            List<InstructionNode> children;
            if (childArray != null && childArray.length > 0) {
                children = new ArrayList<>(childArray.length);
                for (int i = 0; i < childArray.length; i++) {
                    InstructionNode child = serializeInstruction(childArray[i], i, gameTime);
                    if (child != null) {
                        children.add(child);
                    }
                }
            } else {
                children = Collections.emptyList();
            }

            return new InstructionNode(index, name, tag, continueAfter, treeMode, weight,
                sensor, actions, children);

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to serialize instruction at index %d: %s", index, e.getMessage());
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SENSORS
    // ═══════════════════════════════════════════════════════════════

    private SensorNode serializeSensor(Object sensor, Instant gameTime) {
        if (sensor == null) {
            return SensorNode.simple("Null", false, false);
        }

        try {
            String className = sensor.getClass().getSimpleName();
            String type = cleanTypeName(className, "Sensor");

            // Read base fields from SensorBase (once, triggered)
            boolean once = getFieldValue(sensor, "once", Boolean.class, false);
            boolean triggered = getFieldValue(sensor, "triggered", Boolean.class, false);

            // Check for specific sensor types
            if (className.equals("SensorAlarm")) {
                return serializeSensorAlarm(sensor, type, once, triggered, gameTime);
            }
            if (className.equals("SensorTimer")) {
                return serializeSensorTimer(sensor, type, once, triggered);
            }
            if (className.equals("SensorAnd") || className.equals("SensorOr")) {
                return serializeSensorCompound(sensor, type, once, triggered, gameTime);
            }
            if (className.equals("SensorNot")) {
                return serializeSensorNot(sensor, type, once, triggered, gameTime);
            }
            if (className.equals("NullSensor")) {
                return SensorNode.simple("Any", false, false);
            }

            // Generic extraction for all other sensor types
            Map<String, Object> props = extractSensorProperties(sensor);
            return SensorNode.withProperties(type, once, triggered, props);

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to serialize sensor: %s", e.getMessage());
            return SensorNode.simple("Error", false, false);
        }
    }

    private SensorNode serializeSensorAlarm(Object sensor, String type,
                                             boolean once, boolean triggered,
                                             Instant gameTime) {
        try {
            // Read alarm reference
            Object alarm = getFieldValue(sensor, "alarm", Object.class);
            boolean clear = getFieldValue(sensor, "clear", Boolean.class, false);

            // Read expected state enum
            Object stateEnum = getFieldValue(sensor, "state", Object.class);
            String expected = stateEnum != null ? stateEnum.toString() : "UNKNOWN";

            // Read alarm name - alarm is a PersistentParameter, try to get its name
            String alarmName = null;
            if (alarm != null) {
                alarmName = getFieldValue(alarm, "name", String.class);
                if (alarmName == null) {
                    // Try to get from the alarm's toString or parameterName
                    alarmName = getFieldValue(alarm, "parameterName", String.class);
                }
            }

            // Determine actual alarm state by reading alarmInstant field
            String actual = "UNSET";
            if (alarm != null) {
                Instant alarmInstant = getFieldValue(alarm, "alarmInstant", Instant.class);
                if (alarmInstant == null) {
                    actual = "UNSET";
                } else if (gameTime != null && gameTime.isAfter(alarmInstant)) {
                    actual = "PASSED";
                } else {
                    actual = "SET";
                }
            }

            Map<String, Object> props = extractSensorProperties(sensor);
            return SensorNode.alarm(type, once, triggered, alarmName, expected, actual, clear, props);

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to serialize alarm sensor: %s", e.getMessage());
            return SensorNode.simple(type, once, triggered);
        }
    }

    private SensorNode serializeSensorTimer(Object sensor, String type,
                                             boolean once, boolean triggered) {
        try {
            // Read timer reference
            Object timer = getFieldValue(sensor, "timer", Object.class);

            // Expected state
            Object timerStateEnum = getFieldValue(sensor, "timerState", Object.class);
            String expectedState = timerStateEnum != null ? timerStateEnum.toString() : "ANY";

            // Min/max time remaining thresholds
            double minRemaining = getFieldValue(sensor, "minTimeRemaining", Double.class, 0.0);
            double maxRemaining = getFieldValue(sensor, "maxTimeRemaining", Double.class, Double.MAX_VALUE);

            // Read actual timer state
            String actualState = "STOPPED";
            double value = 0.0;
            double maxValue = 0.0;

            if (timer != null) {
                Object stateObj = getFieldValue(timer, "state", Object.class);
                actualState = stateObj != null ? stateObj.toString() : "STOPPED";
                value = getFieldValue(timer, "value", Double.class, 0.0);
                maxValue = getFieldValue(timer, "maxValue", Double.class, 0.0);
            }

            Map<String, Object> props = extractSensorProperties(sensor);
            return SensorNode.timer(type, once, triggered,
                expectedState, actualState, value, maxValue, minRemaining, maxRemaining, props);

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to serialize timer sensor: %s", e.getMessage());
            return SensorNode.simple(type, once, triggered);
        }
    }

    private SensorNode serializeSensorCompound(Object sensor, String type,
                                                boolean once, boolean triggered,
                                                Instant gameTime) {
        try {
            // SensorMany has a 'sensors' field (Sensor[])
            Object sensorsArray = getFieldValue(sensor, "sensors", Object.class);
            List<SensorNode> children = new ArrayList<>();

            if (sensorsArray instanceof Object[] arr) {
                for (Object child : arr) {
                    SensorNode childNode = serializeSensor(child, gameTime);
                    children.add(childNode);
                }
            }

            Map<String, Object> props = extractSensorProperties(sensor);
            return SensorNode.compound(type, once, triggered, children, props);

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to serialize compound sensor: %s", e.getMessage());
            return SensorNode.simple(type, once, triggered);
        }
    }

    private SensorNode serializeSensorNot(Object sensor, String type,
                                           boolean once, boolean triggered,
                                           Instant gameTime) {
        try {
            // SensorNot has a single 'sensor' field
            Object innerSensor = getFieldValue(sensor, "sensor", Object.class);
            SensorNode childNode = serializeSensor(innerSensor, gameTime);

            List<SensorNode> children = new ArrayList<>();
            if (childNode != null) {
                children.add(childNode);
            }

            Map<String, Object> props = extractSensorProperties(sensor);
            return SensorNode.compound(type, once, triggered, children, props);

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to serialize Not sensor: %s", e.getMessage());
            return SensorNode.simple(type, once, triggered);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // GENERIC SENSOR PROPERTY EXTRACTION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Extract serializable properties from any sensor via reflection.
     * Walks declared fields from the sensor class up to (not including) SensorBase.
     * Only includes primitives, String, enums, Instant, arrays, EnumSets, and List&lt;String&gt;.
     */
    private Map<String, Object> extractSensorProperties(Object sensor) {
        Map<String, Object> props = new LinkedHashMap<>();
        Class<?> clazz = sensor.getClass();

        while (clazz != null && !clazz.getSimpleName().equals("SensorBase")
               && clazz != Object.class) {
            for (Field field : clazz.getDeclaredFields()) {
                String name = field.getName();
                if (SKIP_FIELDS.contains(name)) continue;
                if (java.lang.reflect.Modifier.isStatic(field.getModifiers())) continue;

                Class<?> type = field.getType();

                try {
                    if (SERIALIZABLE_TYPES.contains(type)) {
                        Object value = getFieldValue(sensor, name, Object.class);
                        if (value != null) props.put(name, value);
                    } else if (type.isEnum()) {
                        Object value = getFieldValue(sensor, name, Object.class);
                        if (value != null) props.put(name, value.toString());
                    } else if (type == Instant.class) {
                        Instant value = getFieldValue(sensor, name, Instant.class);
                        if (value != null) props.put(name, value.toString());
                    } else if (type == int[].class) {
                        int[] arr = getFieldValue(sensor, name, int[].class);
                        if (arr != null && arr.length > 0) props.put(name, arr);
                    } else if (type == String[].class) {
                        String[] arr = getFieldValue(sensor, name, String[].class);
                        if (arr != null && arr.length > 0) props.put(name, arr);
                    }
                    // EnumSet: convert to string list
                    else if (java.util.EnumSet.class.isAssignableFrom(type) ||
                             field.getGenericType().getTypeName().contains("EnumSet")) {
                        Object value = getFieldValue(sensor, name, Object.class);
                        if (value instanceof Collection<?> c && !c.isEmpty()) {
                            props.put(name, c.stream().map(Object::toString).toList());
                        }
                    }
                    // List<String>
                    else if (List.class.isAssignableFrom(type)) {
                        Object value = getFieldValue(sensor, name, Object.class);
                        if (value instanceof List<?> list && !list.isEmpty()
                            && list.getFirst() instanceof String) {
                            props.put(name, list);
                        }
                    }
                } catch (Exception e) {
                    // Skip fields that can't be read
                }
            }
            clazz = clazz.getSuperclass();
        }
        return props.isEmpty() ? null : props;
    }

    // ═══════════════════════════════════════════════════════════════
    // ACTIONS
    // ═══════════════════════════════════════════════════════════════

    private List<ActionNode> serializeActions(Instruction instruction) {
        try {
            // Instruction.actions is an ActionList
            Object actionList = getFieldValue(instruction, "actions", Object.class);
            if (actionList == null) {
                return Collections.emptyList();
            }

            // ActionList.actions is an Action[]
            Object actionsArray = getFieldValue(actionList, "actions", Object.class);
            if (!(actionsArray instanceof Object[] arr) || arr.length == 0) {
                return Collections.emptyList();
            }

            List<ActionNode> result = new ArrayList<>(arr.length);
            for (Object action : arr) {
                if (action == null) continue;

                String className = action.getClass().getSimpleName();
                String type = cleanTypeName(className, "Action");

                boolean once = getFieldValue(action, "once", Boolean.class, false);
                boolean actionTriggered = getFieldValue(action, "triggered", Boolean.class, false);
                boolean active = getFieldValue(action, "active", Boolean.class, false);

                Map<String, Object> props = extractActionProperties(action);
                if (props != null && !props.isEmpty()) {
                    result.add(ActionNode.withProperties(type, once, actionTriggered, active, props));
                } else {
                    result.add(ActionNode.simple(type, once, actionTriggered, active));
                }
            }
            return result;

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to serialize actions: %s", e.getMessage());
            return Collections.emptyList();
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // GENERIC ACTION PROPERTY EXTRACTION
    // ═══════════════════════════════════════════════════════════════

    /**
     * Extract serializable properties from any action via reflection.
     * Mirrors extractSensorProperties() but walks up to ActionBase and uses ACTION_SKIP_FIELDS.
     */
    private Map<String, Object> extractActionProperties(Object action) {
        Map<String, Object> props = new LinkedHashMap<>();
        Class<?> clazz = action.getClass();

        while (clazz != null && !clazz.getSimpleName().equals("ActionBase")
               && clazz != Object.class) {
            for (Field field : clazz.getDeclaredFields()) {
                String name = field.getName();
                if (ACTION_SKIP_FIELDS.contains(name)) continue;
                if (java.lang.reflect.Modifier.isStatic(field.getModifiers())) continue;

                Class<?> type = field.getType();

                try {
                    if (SERIALIZABLE_TYPES.contains(type)) {
                        Object value = getFieldValue(action, name, Object.class);
                        if (value != null) props.put(name, value);
                    } else if (type.isEnum()) {
                        Object value = getFieldValue(action, name, Object.class);
                        if (value != null) props.put(name, value.toString());
                    } else if (type == Instant.class) {
                        Instant value = getFieldValue(action, name, Instant.class);
                        if (value != null) props.put(name, value.toString());
                    } else if (type == int[].class) {
                        int[] arr = getFieldValue(action, name, int[].class);
                        if (arr != null && arr.length > 0) props.put(name, arr);
                    } else if (type == String[].class) {
                        String[] arr = getFieldValue(action, name, String[].class);
                        if (arr != null && arr.length > 0) props.put(name, arr);
                    }
                    // EnumSet: convert to string list
                    else if (java.util.EnumSet.class.isAssignableFrom(type) ||
                             field.getGenericType().getTypeName().contains("EnumSet")) {
                        Object value = getFieldValue(action, name, Object.class);
                        if (value instanceof Collection<?> c && !c.isEmpty()) {
                            props.put(name, c.stream().map(Object::toString).toList());
                        }
                    }
                    // List<String>
                    else if (List.class.isAssignableFrom(type)) {
                        Object value = getFieldValue(action, name, Object.class);
                        if (value instanceof List<?> list && !list.isEmpty()
                            && list.getFirst() instanceof String) {
                            props.put(name, list);
                        }
                    }
                } catch (Exception e) {
                    // Skip fields that can't be read
                }
            }
            clazz = clazz.getSuperclass();
        }
        return props.isEmpty() ? null : props;
    }

    // ═══════════════════════════════════════════════════════════════
    // REFLECTION HELPERS
    // ═══════════════════════════════════════════════════════════════

    /**
     * Get the instructionList array from an Instruction.
     */
    private Instruction[] getInstructionList(Instruction instruction) {
        try {
            Object value = getFieldValue(instruction, "instructionList", Object.class);
            if (value instanceof Instruction[] arr) {
                return arr;
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Get a field value via reflection, searching the class hierarchy.
     * Uses a cache to avoid repeated reflection lookups.
     */
    @SuppressWarnings("unchecked")
    private <T> T getFieldValue(Object obj, String fieldName, Class<T> type) {
        return getFieldValue(obj, fieldName, type, null);
    }

    @SuppressWarnings("unchecked")
    private <T> T getFieldValue(Object obj, String fieldName, Class<T> type, T defaultValue) {
        if (obj == null) {
            return defaultValue;
        }

        try {
            String cacheKey = obj.getClass().getName() + "#" + fieldName;
            Field field = fieldCache.computeIfAbsent(cacheKey, k -> findField(obj.getClass(), fieldName));

            if (field == null) {
                return defaultValue;
            }

            Object value = field.get(obj);
            if (value == null) {
                return defaultValue;
            }

            // Handle auto-unboxing for primitives
            if (type == Boolean.class && value instanceof Boolean) {
                return (T) value;
            }
            if (type == Double.class && value instanceof Number num) {
                return (T) Double.valueOf(num.doubleValue());
            }

            if (type.isInstance(value)) {
                return type.cast(value);
            }

            // For Object.class, return as-is
            if (type == Object.class) {
                return (T) value;
            }

            return defaultValue;

        } catch (Exception e) {
            return defaultValue;
        }
    }

    /**
     * Find a field by name, searching up the class hierarchy.
     */
    private Field findField(Class<?> clazz, String fieldName) {
        Class<?> current = clazz;
        while (current != null && current != Object.class) {
            try {
                Field field = current.getDeclaredField(fieldName);
                field.setAccessible(true);
                return field;
            } catch (NoSuchFieldException e) {
                current = current.getSuperclass();
            }
        }
        return null;
    }

    /**
     * Clean a class name by removing a prefix/suffix.
     * e.g., "SensorAlarm" -> "Alarm", "ActionSetAlarm" -> "SetAlarm"
     */
    private String cleanTypeName(String className, String prefix) {
        if (className.startsWith(prefix) && className.length() > prefix.length()) {
            return className.substring(prefix.length());
        }
        return className;
    }
}
