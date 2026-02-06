package com.laits.inspector.cache;

import com.hypixel.hytale.logger.HytaleLogger;
import com.laits.inspector.core.ComponentSerializer;
import com.laits.inspector.data.ComponentData;
import com.laits.inspector.data.EntitySnapshot;
import com.laits.inspector.data.PacketLogEntry;

import java.lang.ref.WeakReference;
import java.lang.reflect.Array;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory cache implementation using WeakReferences for lazy expansion.
 * Fast but not persistent across restarts.
 */
public class InMemoryCache implements InspectorCache {
    private static final HytaleLogger LOGGER = HytaleLogger.forEnclosingClass();

    // Entity caches
    private final Map<Long, EntitySnapshot> entitySnapshots = Collections.synchronizedMap(new LinkedHashMap<>());
    private final Map<Long, Map<String, WeakReference<Object>>> componentRefs = new ConcurrentHashMap<>();

    // Packet caches - use strong references since we have explicit LRU eviction
    private final Map<Long, Object> packetRefs = new ConcurrentHashMap<>();
    private final LinkedList<Long> packetOrder = new LinkedList<>();  // For LRU eviction

    // Serializer for deep expansion
    private final ComponentSerializer serializer = new ComponentSerializer();

    // Limits
    private int maxEntities = 5000;
    private int maxPackets = 500;

    private final Object entityLock = new Object();
    private final Object packetLock = new Object();

    // ═══════════════════════════════════════════════════════════════
    // ENTITY OPERATIONS
    // ═══════════════════════════════════════════════════════════════

    @Override
    public void putEntity(long entityId, EntitySnapshot snapshot, Map<String, Object> refs) {
        synchronized (entityLock) {
            entitySnapshots.put(entityId, snapshot);

            // Store component refs
            if (refs != null && !refs.isEmpty()) {
                Map<String, WeakReference<Object>> weakRefs = componentRefs.computeIfAbsent(
                        entityId, k -> new ConcurrentHashMap<>());
                for (Map.Entry<String, Object> entry : refs.entrySet()) {
                    if (entry.getValue() != null) {
                        weakRefs.put(entry.getKey(), new WeakReference<>(entry.getValue()));
                    }
                }
            }

            // Evict if over limit
            while (entitySnapshots.size() > maxEntities) {
                Iterator<Long> it = entitySnapshots.keySet().iterator();
                if (it.hasNext()) {
                    Long oldestId = it.next();
                    it.remove();
                    componentRefs.remove(oldestId);
                }
            }
        }
    }

    @Override
    public EntitySnapshot getEntitySnapshot(long entityId) {
        return entitySnapshots.get(entityId);
    }

    @Override
    public Object expandEntityPath(long entityId, String path) {
        EntitySnapshot entity = entitySnapshots.get(entityId);
        if (entity == null) {
            return null;
        }

        try {
            String[] parts = path.split("\\.");

            // Must start with "components"
            if (parts.length < 2 || !"components".equals(parts[0])) {
                return expandFromSnapshot(entity, path);
            }

            String componentName = parts[1];

            // Try to get the actual component object from refs cache
            Map<String, WeakReference<Object>> refs = componentRefs.get(entityId);
            if (refs != null) {
                WeakReference<Object> ref = refs.get(componentName);
                if (ref != null) {
                    Object component = ref.get();
                    if (component != null) {
                        // Skip "fields" if present (serialization artifact)
                        int startIndex = 2;
                        if (parts.length > 2 && "fields".equals(parts[2])) {
                            startIndex = 3;
                        }

                        Object current = component;
                        for (int i = startIndex; i < parts.length; i++) {
                            current = navigateField(current, parts[i]);
                            if (current == null) {
                                break;
                            }
                        }

                        if (current != null) {
                            return serializer.serializeDeep(current);
                        }
                    }
                }
            }

            // Fallback to snapshot data
            return expandFromSnapshot(entity, path);

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to expand entity path %s: %s", path, e.getMessage());
        }

        return null;
    }

    @Override
    public Object getLiveComponent(long entityId, String componentName) {
        Map<String, WeakReference<Object>> refs = componentRefs.get(entityId);
        if (refs == null) {
            return null;
        }
        WeakReference<Object> ref = refs.get(componentName);
        if (ref == null) {
            return null;
        }
        return ref.get(); // May return null if GC'd
    }

    @Override
    public void removeEntity(long entityId) {
        synchronized (entityLock) {
            entitySnapshots.remove(entityId);
            componentRefs.remove(entityId);
        }
    }

    @Override
    public Collection<EntitySnapshot> getAllEntities() {
        return new ArrayList<>(entitySnapshots.values());
    }

    @Override
    public int getEntityCount() {
        return entitySnapshots.size();
    }

    // ═══════════════════════════════════════════════════════════════
    // PACKET OPERATIONS
    // ═══════════════════════════════════════════════════════════════

    @Override
    public void putPacket(PacketLogEntry entry, Object originalPacket) {
        if (originalPacket == null) {
            LOGGER.atWarning().log("putPacket called with null originalPacket");
            return;
        }

        synchronized (packetLock) {
            long packetId = entry.getId();
            packetRefs.put(packetId, originalPacket);
            packetOrder.addLast(packetId);

            // Evict oldest if over limit
            while (packetOrder.size() > maxPackets) {
                Long oldestId = packetOrder.removeFirst();
                packetRefs.remove(oldestId);
            }
        }
    }

    @Override
    public Object expandPacketPath(long packetId, String path) {
        LOGGER.atInfo().log("expandPacketPath: packetId=%d, path=%s, cached packets=%d", packetId, path, packetRefs.size());

        Object packet = packetRefs.get(packetId);
        if (packet == null) {
            LOGGER.atWarning().log("Packet %d not found in cache. Available: %s", packetId, packetRefs.keySet());
            return null;
        }

        LOGGER.atInfo().log("Found packet %d: %s", packetId, packet.getClass().getSimpleName());

        try {
            String[] parts = path.split("\\.");

            // Skip "data" prefix if present (it's the serialization wrapper)
            int startIndex = 0;
            if (parts.length > 0 && "data".equals(parts[0])) {
                startIndex = 1;
            }

            Object current = packet;
            for (int i = startIndex; i < parts.length; i++) {
                String part = parts[i];
                LOGGER.atInfo().log("Packet nav: '%s' on %s", part, current.getClass().getSimpleName());
                Object next = navigateField(current, part);
                if (next == null) {
                    LOGGER.atWarning().log("Packet nav failed at '%s' on %s (fields: %s)",
                            part, current.getClass().getSimpleName(), getFieldNames(current));
                    break;
                }
                current = next;
            }

            if (current != null) {
                return serializer.serializeDeep(current);
            }

        } catch (Exception e) {
            LOGGER.atWarning().log("Failed to expand packet path %s: %s", path, e.getMessage());
        }

        return null;
    }

    /**
     * Get field names for debugging.
     */
    private String getFieldNames(Object obj) {
        if (obj == null) return "null";
        try {
            List<String> names = new ArrayList<>();
            Class<?> clazz = obj.getClass();
            while (clazz != null && clazz != Object.class) {
                for (var field : clazz.getDeclaredFields()) {
                    names.add(field.getName());
                }
                clazz = clazz.getSuperclass();
            }
            return names.toString();
        } catch (Exception e) {
            return "error: " + e.getMessage();
        }
    }

    @Override
    public int getPacketCount() {
        return packetRefs.size();
    }

    // ═══════════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═══════════════════════════════════════════════════════════════

    @Override
    public void clear() {
        synchronized (entityLock) {
            entitySnapshots.clear();
            componentRefs.clear();
        }
        synchronized (packetLock) {
            packetRefs.clear();
            packetOrder.clear();
        }
    }

    @Override
    public void setLimits(int maxEntities, int maxPackets) {
        this.maxEntities = maxEntities;
        this.maxPackets = maxPackets;
    }

    // ═══════════════════════════════════════════════════════════════
    // NAVIGATION HELPERS
    // ═══════════════════════════════════════════════════════════════

    private Object navigateField(Object obj, String fieldName) {
        if (obj == null) {
            return null;
        }

        // Handle Maps
        if (obj instanceof Map<?, ?> map) {
            // First try direct string lookup
            Object directResult = map.get(fieldName);
            if (directResult != null) {
                return directResult;
            }
            // Fallback: find key by toString() match (for non-string keys like Ref objects)
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (String.valueOf(entry.getKey()).equals(fieldName)) {
                    return entry.getValue();
                }
            }
            return null;
        }

        // Handle Lists
        if (obj instanceof List<?> list) {
            try {
                int index = Integer.parseInt(fieldName);
                if (index >= 0 && index < list.size()) {
                    return list.get(index);
                }
            } catch (NumberFormatException e) {
                // Not a valid index
            }
            return null;
        }

        // Handle arrays
        if (obj.getClass().isArray()) {
            try {
                int index = Integer.parseInt(fieldName);
                int length = Array.getLength(obj);
                if (index >= 0 && index < length) {
                    return Array.get(obj, index);
                }
            } catch (NumberFormatException e) {
                // Not a valid index
            }
            return null;
        }

        // Use reflection for other objects
        try {
            Class<?> clazz = obj.getClass();
            while (clazz != null && clazz != Object.class) {
                try {
                    var field = clazz.getDeclaredField(fieldName);
                    field.setAccessible(true);
                    return field.get(obj);
                } catch (NoSuchFieldException e) {
                    clazz = clazz.getSuperclass();
                }
            }
        } catch (Exception e) {
            // Field access failed
        }

        return null;
    }

    private Object expandFromSnapshot(EntitySnapshot entity, String path) {
        Object current = entity;
        String[] parts = path.split("\\.");

        for (String part : parts) {
            if (current == null) {
                return null;
            }

            if (current instanceof EntitySnapshot snapshot) {
                if ("components".equals(part)) {
                    current = snapshot.getComponents();
                } else {
                    return null;
                }
            } else if (current instanceof Map<?, ?> map) {
                current = map.get(part);
            } else if (current instanceof ComponentData compData) {
                current = compData.getFields().get(part);
            } else if (current instanceof List<?> list) {
                try {
                    int index = Integer.parseInt(part);
                    if (index >= 0 && index < list.size()) {
                        current = list.get(index);
                    } else {
                        return null;
                    }
                } catch (NumberFormatException e) {
                    return null;
                }
            } else {
                return null;
            }
        }

        return current;
    }
}
