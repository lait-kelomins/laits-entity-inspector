package com.laits.inspector.core;

import com.hypixel.hytale.math.vector.Vector3d;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.*;

/**
 * Serializes network packet objects to Map for JSON transport.
 * Uses reflection to extract field values from packet classes.
 */
public class PacketSerializer {

    private static final String REDACTED = "[REDACTED]";

    // Sensitive fields that should be obfuscated for security
    // Map of packet class name (simple) -> Set of field names to redact
    private static final Map<String, Set<String>> SENSITIVE_FIELDS = Map.of(
            "Connect", Set.of("identityToken"),
            "AuthGrant", Set.of("authorizationGrant", "serverIdentityToken"),
            "AuthToken", Set.of("accessToken", "serverAuthorizationGrant"),
            "ServerAuthToken", Set.of("serverAccessToken")
    );

    // Cache for packet field access
    private final Map<Class<?>, List<Field>> fieldCache = new HashMap<>();

    // Depth at which to use expandable markers for lazy loading
    private static final int EXPANDABLE_DEPTH = 2;

    /**
     * Serialize a packet object to a Map of field names to values.
     * Returns an empty map if packet is null or cannot be serialized.
     */
    public Map<String, Object> serialize(Object packet) {
        if (packet == null) {
            return Collections.emptyMap();
        }

        String packetName = packet.getClass().getSimpleName();
        Map<String, Object> fields = new LinkedHashMap<>();
        serializeFields(packet, fields, 0, packetName);
        return fields;
    }

    private void serializeFields(Object packet, Map<String, Object> fields, int depth, String rootPacketName) {
        List<Field> accessibleFields = getAccessibleFields(packet.getClass());
        String className = packet.getClass().getSimpleName();

        // Check if this class has sensitive fields
        Set<String> sensitiveFieldNames = SENSITIVE_FIELDS.get(className);
        if (sensitiveFieldNames == null) {
            // Also check root packet name for nested objects
            sensitiveFieldNames = SENSITIVE_FIELDS.get(rootPacketName);
        }

        for (Field field : accessibleFields) {
            try {
                String fieldName = field.getName();

                // Check if this field should be redacted
                if (sensitiveFieldNames != null && sensitiveFieldNames.contains(fieldName)) {
                    fields.put(fieldName, REDACTED);
                    continue;
                }

                Object value = field.get(packet);
                Object serialized = serializeValue(value, depth, rootPacketName);
                if (serialized != null) {
                    fields.put(fieldName, serialized);
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

    /**
     * Serialize a value to a JSON-safe representation.
     * Limits recursion depth to avoid infinite loops.
     */
    private Object serializeValue(Object value, int depth, String rootPacketName) {
        if (value == null || depth > 5) {
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

        // byte[] as hex string (common in packets)
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
            if (col.size() > 50) {
                return String.format("[%d items]", col.size());
            }
            List<Object> list = new ArrayList<>();
            for (Object item : col) {
                Object serialized = serializeValue(item, depth + 1, rootPacketName);
                if (serialized != null) {
                    list.add(serialized);
                }
            }
            return list.isEmpty() ? null : list;
        }

        // Maps
        if (value instanceof Map<?, ?> map) {
            if (map.isEmpty()) return null;
            if (map.size() > 50) {
                return String.format("{%d entries}", map.size());
            }
            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = String.valueOf(entry.getKey());
                Object serialized = serializeValue(entry.getValue(), depth + 1, rootPacketName);
                if (serialized != null) {
                    result.put(key, serialized);
                }
            }
            return result.isEmpty() ? null : result;
        }

        // Arrays
        if (value.getClass().isArray()) {
            if (value instanceof int[] arr) {
                if (arr.length > 50) return String.format("[%d ints]", arr.length);
                return Arrays.stream(arr).boxed().toList();
            }
            if (value instanceof long[] arr) {
                if (arr.length > 50) return String.format("[%d longs]", arr.length);
                return Arrays.stream(arr).boxed().toList();
            }
            if (value instanceof double[] arr) {
                if (arr.length > 50) return String.format("[%d doubles]", arr.length);
                return Arrays.stream(arr).boxed().toList();
            }
            if (value instanceof float[] arr) {
                if (arr.length > 50) return String.format("[%d floats]", arr.length);
                List<Float> list = new ArrayList<>();
                for (float f : arr) list.add(f);
                return list;
            }
            if (value instanceof Object[] arr) {
                if (arr.length > 50) return String.format("[%d objects]", arr.length);
                List<Object> list = new ArrayList<>();
                for (Object item : arr) {
                    Object serialized = serializeValue(item, depth + 1, rootPacketName);
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
        serializeFields(value, nested, depth + 1, rootPacketName);
        if (!nested.isEmpty()) {
            nested.put("_type", typeName);
            return nested;
        }

        // Fallback: just return the class name if no fields could be serialized
        return "[" + typeName + "]";
    }
}
