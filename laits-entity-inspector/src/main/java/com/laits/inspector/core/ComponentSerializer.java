package com.laits.inspector.core;

import com.hypixel.hytale.math.vector.Vector3d;
import com.hypixel.hytale.server.core.modules.entity.component.ModelComponent;
import com.hypixel.hytale.server.core.modules.entity.component.TransformComponent;
import com.hypixel.hytale.server.npc.entities.NPCEntity;
import com.laits.inspector.data.ComponentData;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.*;

/**
 * Serializes ECS components to ComponentData for transport.
 * Uses reflection to extract field values safely.
 */
public class ComponentSerializer {

    // Cache for component field access
    private final Map<Class<?>, List<Field>> fieldCache = new HashMap<>();

    /**
     * Serialize a component to ComponentData.
     * Returns null if component is null or cannot be serialized.
     */
    public ComponentData serialize(Object component) {
        if (component == null) {
            return null;
        }

        String typeName = component.getClass().getSimpleName();
        Map<String, Object> fields = new LinkedHashMap<>();

        // Handle known component types with specific serialization
        if (component instanceof TransformComponent transform) {
            serializeTransform(transform, fields);
        } else if (component instanceof ModelComponent model) {
            serializeModel(model, fields);
        } else if (component instanceof NPCEntity npc) {
            serializeNPC(npc, fields);
        } else {
            // Generic reflection-based serialization
            serializeGeneric(component, fields);
        }

        return new ComponentData(typeName, fields);
    }

    /**
     * Deep serialize an object for expansion requests.
     * Uses higher depth limit for lazy loading.
     */
    public Object serializeDeep(Object value) {
        if (value == null) {
            return null;
        }
        return serializeValueDeep(value, 0);
    }

    /**
     * Serialize with deeper depth limit for expansion.
     */
    private Object serializeValueDeep(Object value, int depth) {
        if (value == null || depth > MAX_DEPTH) {
            return null;
        }

        // Primitive types and strings
        if (value instanceof Number || value instanceof Boolean || value instanceof String) {
            return value;
        }

        // Enums
        if (value instanceof Enum<?>) {
            return ((Enum<?>) value).name();
        }

        // UUID
        if (value instanceof UUID) {
            return value.toString();
        }

        // Hytale Vector3d
        if (value instanceof Vector3d vec) {
            return Arrays.asList(vec.getX(), vec.getY(), vec.getZ());
        }

        // Java Instant - serialize as epoch millis and ISO string
        if (value instanceof java.time.Instant instant) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("epochMilli", instant.toEpochMilli());
            result.put("iso", instant.toString());
            result.put("_type", "Instant");
            return result;
        }

        // Hytale Alarm - use reflection to extract fields
        String className = value.getClass().getSimpleName();
        if ("Alarm".equals(className)) {
            return serializeAlarm(value);
        }

        // byte[] as hex string
        if (value instanceof byte[] bytes) {
            if (bytes.length == 0) return "[]";
            if (bytes.length > 100) {
                return String.format("[%d bytes]", bytes.length);
            }
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < bytes.length; i++) {
                if (i > 0) sb.append(' ');
                sb.append(String.format("%02X", bytes[i] & 0xFF));
            }
            return sb.toString();
        }

        // Collections
        if (value instanceof Collection<?> col) {
            if (col.isEmpty()) return null;
            if (col.size() > MAX_COLLECTION_SIZE) {
                return String.format("[%d items]", col.size());
            }
            List<Object> list = new ArrayList<>();
            for (Object item : col) {
                Object serialized = serializeValueDeep(item, depth + 1);
                if (serialized != null) {
                    list.add(serialized);
                }
            }
            return list.isEmpty() ? null : list;
        }

        // Maps
        if (value instanceof Map<?, ?> map) {
            if (map.isEmpty()) return null;
            if (map.size() > MAX_COLLECTION_SIZE) {
                return String.format("{%d entries}", map.size());
            }
            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = String.valueOf(entry.getKey());
                Object serialized = serializeValueDeep(entry.getValue(), depth + 1);
                if (serialized != null) {
                    result.put(key, serialized);
                }
            }
            return result.isEmpty() ? null : result;
        }

        // Arrays
        if (value.getClass().isArray()) {
            if (value instanceof int[] arr) {
                if (arr.length > MAX_COLLECTION_SIZE) return String.format("[%d ints]", arr.length);
                return Arrays.stream(arr).boxed().toList();
            }
            if (value instanceof long[] arr) {
                if (arr.length > MAX_COLLECTION_SIZE) return String.format("[%d longs]", arr.length);
                return Arrays.stream(arr).boxed().toList();
            }
            if (value instanceof double[] arr) {
                if (arr.length > MAX_COLLECTION_SIZE) return String.format("[%d doubles]", arr.length);
                return Arrays.stream(arr).boxed().toList();
            }
            if (value instanceof float[] arr) {
                if (arr.length > MAX_COLLECTION_SIZE) return String.format("[%d floats]", arr.length);
                List<Float> list = new ArrayList<>();
                for (float f : arr) list.add(f);
                return list;
            }
            if (value instanceof Object[] arr) {
                if (arr.length > MAX_COLLECTION_SIZE) return String.format("[%d objects]", arr.length);
                List<Object> list = new ArrayList<>();
                for (Object item : arr) {
                    Object serialized = serializeValueDeep(item, depth + 1);
                    if (serialized != null) {
                        list.add(serialized);
                    }
                }
                return list.isEmpty() ? null : list;
            }
        }

        // Complex objects - always expand in deep mode
        String typeName = value.getClass().getSimpleName();
        Map<String, Object> nested = new LinkedHashMap<>();
        serializeGenericDeep(value, nested, depth + 1);
        if (!nested.isEmpty()) {
            nested.put("_type", typeName);
            return nested;
        }

        return "[" + typeName + "]";
    }

    /**
     * Serialize a Hytale Alarm object using reflection.
     * Alarms typically have: isSet(), hasPassed(), getAlarmInstant()
     */
    private Object serializeAlarm(Object alarm) {
        Map<String, Object> result = new LinkedHashMap<>();
        Class<?> clazz = alarm.getClass();

        try {
            // Try to call isSet()
            try {
                java.lang.reflect.Method isSetMethod = clazz.getMethod("isSet");
                Object isSet = isSetMethod.invoke(alarm);
                if (isSet instanceof Boolean) {
                    result.put("isSet", isSet);
                }
            } catch (NoSuchMethodException e) {
                // Method not available
            }

            // Try to call hasPassed()
            try {
                java.lang.reflect.Method hasPassedMethod = clazz.getMethod("hasPassed");
                Object hasPassed = hasPassedMethod.invoke(alarm);
                if (hasPassed instanceof Boolean) {
                    result.put("hasPassed", hasPassed);
                }
            } catch (NoSuchMethodException e) {
                // Method not available
            }

            // Try to call getAlarmInstant()
            try {
                java.lang.reflect.Method getInstantMethod = clazz.getMethod("getAlarmInstant");
                Object instant = getInstantMethod.invoke(alarm);
                if (instant instanceof java.time.Instant inst) {
                    Map<String, Object> instantData = new LinkedHashMap<>();
                    instantData.put("epochMilli", inst.toEpochMilli());
                    instantData.put("iso", inst.toString());
                    result.put("alarmInstant", instantData);
                }
            } catch (NoSuchMethodException e) {
                // Method not available - try alternate names
                try {
                    java.lang.reflect.Method getInstantMethod = clazz.getMethod("getInstant");
                    Object instant = getInstantMethod.invoke(alarm);
                    if (instant instanceof java.time.Instant inst) {
                        Map<String, Object> instantData = new LinkedHashMap<>();
                        instantData.put("epochMilli", inst.toEpochMilli());
                        instantData.put("iso", inst.toString());
                        result.put("alarmInstant", instantData);
                    }
                } catch (NoSuchMethodException e2) {
                    // Method not available
                }
            }

            // Try to get the scheduled time directly from field
            try {
                java.lang.reflect.Field instantField = clazz.getDeclaredField("alarmInstant");
                instantField.setAccessible(true);
                Object instant = instantField.get(alarm);
                if (instant instanceof java.time.Instant inst && !result.containsKey("alarmInstant")) {
                    Map<String, Object> instantData = new LinkedHashMap<>();
                    instantData.put("epochMilli", inst.toEpochMilli());
                    instantData.put("iso", inst.toString());
                    result.put("alarmInstant", instantData);
                }
            } catch (NoSuchFieldException e) {
                // Field not available
            }

        } catch (Exception e) {
            // If all fails, return placeholder
            return "[Alarm: " + e.getMessage() + "]";
        }

        if (result.isEmpty()) {
            return "[Alarm]";
        }

        result.put("_type", "Alarm");
        return result;
    }

    private void serializeGenericDeep(Object component, Map<String, Object> fields, int depth) {
        List<Field> accessibleFields = getAccessibleFields(component.getClass());

        for (Field field : accessibleFields) {
            try {
                Object value = field.get(component);
                Object serialized = serializeValueDeep(value, depth);
                if (serialized != null) {
                    fields.put(field.getName(), serialized);
                }
            } catch (Exception e) {
                // Skip this field
            }
        }
    }

    private void serializeTransform(TransformComponent transform, Map<String, Object> fields) {
        try {
            Vector3d pos = transform.getPosition();
            if (pos != null) {
                fields.put("position", Arrays.asList(pos.getX(), pos.getY(), pos.getZ()));
            }
        } catch (Exception e) {
            // Silent - field not accessible
        }
    }

    private void serializeModel(ModelComponent model, Map<String, Object> fields) {
        try {
            var modelObj = model.getModel();
            if (modelObj != null) {
                fields.put("modelAssetId", modelObj.getModelAssetId());
            }
        } catch (Exception e) {
            // Silent
        }
    }

    private void serializeNPC(NPCEntity npc, Map<String, Object> fields) {
        try {
            var role = npc.getRole();
            if (role != null) {
                // Role.getName() may not exist, use getRoleName() from NPCEntity
                fields.put("roleName", npc.getRoleName());
            }
        } catch (Exception e) {
            // Silent
        }
    }

    private void serializeGeneric(Object component, Map<String, Object> fields) {
        serializeGeneric(component, fields, 0);
    }

    private void serializeGeneric(Object component, Map<String, Object> fields, int depth) {
        List<Field> accessibleFields = getAccessibleFields(component.getClass());

        for (Field field : accessibleFields) {
            try {
                Object value = field.get(component);
                Object serialized = serializeValue(value, depth);
                if (serialized != null) {
                    fields.put(field.getName(), serialized);
                }
            } catch (Exception e) {
                // Skip this field
            }
        }
    }

    private List<Field> getAccessibleFields(Class<?> clazz) {
        return fieldCache.computeIfAbsent(clazz, c -> {
            List<Field> result = new ArrayList<>();
            Class<?> current = c;

            while (current != null && current != Object.class) {
                for (Field field : current.getDeclaredFields()) {
                    // Skip static, transient, and synthetic fields
                    int mods = field.getModifiers();
                    if (Modifier.isStatic(mods) || Modifier.isTransient(mods) || field.isSynthetic()) {
                        continue;
                    }

                    try {
                        field.setAccessible(true);
                        result.add(field);
                    } catch (Exception e) {
                        // Cannot access, skip
                    }
                }
                current = current.getSuperclass();
            }

            return result;
        });
    }

    private static final int MAX_DEPTH = 5;
    private static final int MAX_COLLECTION_SIZE = 50;
    private static final int EXPANDABLE_DEPTH = 2;  // Depth at which to use expandable markers

    /**
     * Serialize a value to a JSON-safe representation.
     */
    private Object serializeValue(Object value, int depth) {
        if (value == null || depth > MAX_DEPTH) {
            return null;
        }

        // Primitive types and strings
        if (value instanceof Number || value instanceof Boolean || value instanceof String) {
            return value;
        }

        // Enums
        if (value instanceof Enum<?>) {
            return ((Enum<?>) value).name();
        }

        // UUID
        if (value instanceof UUID) {
            return value.toString();
        }

        // Hytale Vector3d
        if (value instanceof Vector3d vec) {
            return Arrays.asList(vec.getX(), vec.getY(), vec.getZ());
        }

        // Java Instant - serialize as epoch millis and ISO string
        if (value instanceof java.time.Instant instant) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("epochMilli", instant.toEpochMilli());
            result.put("iso", instant.toString());
            result.put("_type", "Instant");
            return result;
        }

        // Hytale Alarm - use reflection to extract fields
        String className = value.getClass().getSimpleName();
        if ("Alarm".equals(className)) {
            return serializeAlarm(value);
        }

        // byte[] as hex string
        if (value instanceof byte[] bytes) {
            if (bytes.length == 0) return "[]";
            if (bytes.length > 100) {
                return String.format("[%d bytes]", bytes.length);
            }
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < bytes.length; i++) {
                if (i > 0) sb.append(' ');
                sb.append(String.format("%02X", bytes[i] & 0xFF));
            }
            return sb.toString();
        }

        // Collections - serialize elements
        if (value instanceof Collection<?> col) {
            if (col.isEmpty()) return null;
            if (col.size() > MAX_COLLECTION_SIZE) {
                return String.format("[%d items]", col.size());
            }
            List<Object> list = new ArrayList<>();
            for (Object item : col) {
                Object serialized = serializeValue(item, depth + 1);
                if (serialized != null) {
                    list.add(serialized);
                }
            }
            return list.isEmpty() ? null : list;
        }

        // Maps
        if (value instanceof Map<?, ?> map) {
            if (map.isEmpty()) return null;
            if (map.size() > MAX_COLLECTION_SIZE) {
                return String.format("{%d entries}", map.size());
            }
            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = String.valueOf(entry.getKey());
                Object serialized = serializeValue(entry.getValue(), depth + 1);
                if (serialized != null) {
                    result.put(key, serialized);
                }
            }
            return result.isEmpty() ? null : result;
        }

        // Arrays
        if (value.getClass().isArray()) {
            if (value instanceof int[] arr) {
                if (arr.length > MAX_COLLECTION_SIZE) return String.format("[%d ints]", arr.length);
                return Arrays.stream(arr).boxed().toList();
            }
            if (value instanceof long[] arr) {
                if (arr.length > MAX_COLLECTION_SIZE) return String.format("[%d longs]", arr.length);
                return Arrays.stream(arr).boxed().toList();
            }
            if (value instanceof double[] arr) {
                if (arr.length > MAX_COLLECTION_SIZE) return String.format("[%d doubles]", arr.length);
                return Arrays.stream(arr).boxed().toList();
            }
            if (value instanceof float[] arr) {
                if (arr.length > MAX_COLLECTION_SIZE) return String.format("[%d floats]", arr.length);
                List<Float> list = new ArrayList<>();
                for (float f : arr) list.add(f);
                return list;
            }
            if (value instanceof Object[] arr) {
                if (arr.length > MAX_COLLECTION_SIZE) return String.format("[%d objects]", arr.length);
                List<Object> list = new ArrayList<>();
                for (Object item : arr) {
                    Object serialized = serializeValue(item, depth + 1);
                    if (serialized != null) {
                        list.add(serialized);
                    }
                }
                return list.isEmpty() ? null : list;
            }
        }

        // For complex objects at or beyond expandable depth, return expandable marker
        String typeName = value.getClass().getSimpleName();

        if (depth >= EXPANDABLE_DEPTH) {
            Map<String, Object> expandable = new LinkedHashMap<>();
            expandable.put("_expandable", true);
            expandable.put("_type", typeName);
            return expandable;
        }

        // Otherwise serialize their fields recursively
        Map<String, Object> nested = new LinkedHashMap<>();
        serializeGeneric(value, nested, depth + 1);
        if (!nested.isEmpty()) {
            nested.put("_type", typeName);
            return nested;
        }

        // Fallback: just return the class name if no fields could be serialized
        return "[" + typeName + "]";
    }
}
