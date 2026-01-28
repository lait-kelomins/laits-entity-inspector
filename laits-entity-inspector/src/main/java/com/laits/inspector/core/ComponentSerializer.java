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
        List<Field> accessibleFields = getAccessibleFields(component.getClass());

        for (Field field : accessibleFields) {
            try {
                Object value = field.get(component);
                Object serialized = serializeValue(value);
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

    /**
     * Serialize a value to a JSON-safe representation.
     */
    private Object serializeValue(Object value) {
        if (value == null) {
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

        // Collections - serialize elements
        if (value instanceof Collection<?> col) {
            List<Object> list = new ArrayList<>();
            for (Object item : col) {
                Object serialized = serializeValue(item);
                if (serialized != null) {
                    list.add(serialized);
                }
            }
            return list.isEmpty() ? null : list;
        }

        // Maps
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                String key = String.valueOf(entry.getKey());
                Object serialized = serializeValue(entry.getValue());
                if (serialized != null) {
                    result.put(key, serialized);
                }
            }
            return result.isEmpty() ? null : result;
        }

        // Arrays
        if (value.getClass().isArray()) {
            if (value instanceof int[] arr) {
                return Arrays.stream(arr).boxed().toList();
            }
            if (value instanceof long[] arr) {
                return Arrays.stream(arr).boxed().toList();
            }
            if (value instanceof double[] arr) {
                return Arrays.stream(arr).boxed().toList();
            }
            if (value instanceof float[] arr) {
                List<Float> list = new ArrayList<>();
                for (float f : arr) list.add(f);
                return list;
            }
            if (value instanceof Object[] arr) {
                List<Object> list = new ArrayList<>();
                for (Object item : arr) {
                    Object serialized = serializeValue(item);
                    if (serialized != null) {
                        list.add(serialized);
                    }
                }
                return list.isEmpty() ? null : list;
            }
        }

        // For complex objects, just return the class name
        return "[" + value.getClass().getSimpleName() + "]";
    }
}
