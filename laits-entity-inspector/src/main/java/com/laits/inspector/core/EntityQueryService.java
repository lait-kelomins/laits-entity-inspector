package com.laits.inspector.core;

import com.laits.inspector.cache.InspectorCache;
import com.laits.inspector.data.*;
import com.laits.inspector.data.InstructionData.InstructionTreeData;

import java.time.Instant;
import java.util.*;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * Service for querying live entities with filtering and timer/alarm extraction.
 */
public class EntityQueryService {
    private final InspectorCache cache;
    private final InstructionSerializer instructionSerializer = new InstructionSerializer();
    private Supplier<Long> gameTimeSupplier;
    private Supplier<Double> gameTimeRateSupplier;

    public EntityQueryService(InspectorCache cache) {
        this.cache = cache;
    }

    /**
     * Set the game time supplier for calculating alarm remaining times.
     * The supplier should return current game time in epoch milliseconds.
     */
    public void setGameTimeSupplier(Supplier<Long> supplier) {
        this.gameTimeSupplier = supplier;
    }

    /**
     * Set the game time rate supplier (game seconds per real second).
     * Used to convert game-time remaining into real-world seconds.
     */
    public void setGameTimeRateSupplier(Supplier<Double> supplier) {
        this.gameTimeRateSupplier = supplier;
    }

    /**
     * Get current game time in epoch millis, or null if unavailable.
     */
    private Long getCurrentGameTimeMillis() {
        return gameTimeSupplier != null ? gameTimeSupplier.get() : null;
    }

    /**
     * Convert game-time seconds to real-world seconds using the game time rate.
     */
    private double toRealSeconds(double gameSeconds) {
        if (gameTimeRateSupplier == null) return gameSeconds;
        Double rate = gameTimeRateSupplier.get();
        if (rate == null || rate <= 0) return gameSeconds;
        return gameSeconds / rate;
    }

    /**
     * List entities with filtering and pagination.
     *
     * @param filter Entity type filter: "npc", "player", "item", or "all"
     * @param search Optional name/role substring search
     * @param limit  Maximum results (default 50)
     * @param offset Pagination offset
     * @return List of entity summaries
     */
    public List<EntitySummary> listEntities(String filter, String search, int limit, int offset) {
        String normalizedFilter = filter != null ? filter.toLowerCase() : "npc";
        int effectiveLimit = limit > 0 ? Math.min(limit, 200) : 50;
        int effectiveOffset = Math.max(offset, 0);

        return cache.getAllEntities().stream()
            .filter(e -> matchesFilter(e, normalizedFilter))
            .filter(e -> matchesSearch(e, search))
            .skip(effectiveOffset)
            .limit(effectiveLimit)
            .map(this::toSummary)
            .collect(Collectors.toList());
    }

    /**
     * Get full entity detail by ID.
     *
     * @param entityId The entity ID
     * @return EntitySnapshot or null if not found
     */
    public EntitySnapshot getEntityDetail(long entityId) {
        return cache.getEntitySnapshot(entityId);
    }

    /**
     * Get formatted timer state for an entity.
     *
     * @param entityId The entity ID
     * @return List of timer info, or empty list if no timers
     */
    public List<TimerInfo> getTimers(long entityId) {
        EntitySnapshot entity = cache.getEntitySnapshot(entityId);
        if (entity == null) {
            return Collections.emptyList();
        }

        return extractTimers(entity);
    }

    /**
     * Get formatted alarm state for an entity.
     *
     * @param entityId The entity ID
     * @return Map of alarm name to info, or empty map if no alarms
     */
    public Map<String, AlarmInfo> getAlarms(long entityId) {
        EntitySnapshot entity = cache.getEntitySnapshot(entityId);
        if (entity == null) {
            return Collections.emptyMap();
        }

        return extractAlarms(entity);
    }

    /**
     * Get instruction tree data for an NPC entity.
     * Accesses the live NPCEntity component via the cache's stored component objects,
     * then uses InstructionSerializer to traverse the instruction tree via reflection.
     *
     * @param entityId The entity ID
     * @return Serialized instruction tree, or null if not found / not NPC
     */
    public InstructionTreeData getInstructions(long entityId) {
        // Get the live NPCEntity component from cache
        Object npcComponent = cache.getLiveComponent(entityId, "NPCEntity");
        if (npcComponent == null) {
            return null;
        }

        if (!(npcComponent instanceof com.hypixel.hytale.server.npc.entities.NPCEntity npc)) {
            return null;
        }

        // Get current game time as Instant for alarm state calculation
        Instant gameTime = null;
        Long gameTimeMs = getCurrentGameTimeMillis();
        if (gameTimeMs != null) {
            gameTime = Instant.ofEpochMilli(gameTimeMs);
        }

        return instructionSerializer.serialize(npc, gameTime);
    }

    /**
     * Find entities with timers in a specific state.
     *
     * @param state Timer state filter: "RUNNING", "PAUSED", "STOPPED", or null for all
     * @param limit Maximum results
     * @return List of entity summaries with matching timers
     */
    public List<EntitySummary> findByTimerState(String state, int limit) {
        int effectiveLimit = limit > 0 ? Math.min(limit, 100) : 20;

        return cache.getAllEntities().stream()
            .filter(e -> hasTimerInState(e, state))
            .limit(effectiveLimit)
            .map(this::toSummary)
            .collect(Collectors.toList());
    }

    /**
     * Find entities with a specific alarm.
     *
     * @param alarmName Alarm name to search for (or null for any)
     * @param state     Alarm state filter: "SET", "PASSED", "UNSET", or null for all
     * @param limit     Maximum results
     * @return List of entity summaries with matching alarms
     */
    public List<EntitySummary> findByAlarm(String alarmName, String state, int limit) {
        int effectiveLimit = limit > 0 ? Math.min(limit, 100) : 20;

        return cache.getAllEntities().stream()
            .filter(e -> hasMatchingAlarm(e, alarmName, state))
            .limit(effectiveLimit)
            .map(this::toSummary)
            .collect(Collectors.toList());
    }

    // ═══════════════════════════════════════════════════════════════
    // FILTER METHODS
    // ═══════════════════════════════════════════════════════════════

    private boolean matchesFilter(EntitySnapshot entity, String filter) {
        if ("all".equals(filter)) {
            return true;
        }

        String type = entity.getEntityType();
        if (type == null) {
            return "all".equals(filter);
        }

        return switch (filter) {
            case "npc" -> "NPC".equalsIgnoreCase(type) || "npc".equalsIgnoreCase(type);
            case "player" -> "PLAYER".equalsIgnoreCase(type) || "player".equalsIgnoreCase(type);
            case "item" -> "ITEM".equalsIgnoreCase(type) || "item".equalsIgnoreCase(type);
            default -> true;
        };
    }

    private boolean matchesSearch(EntitySnapshot entity, String search) {
        if (search == null || search.isBlank()) {
            return true;
        }

        String searchLower = search.toLowerCase();

        // Check name from NPCEntity component
        String name = extractName(entity);
        if (name != null && name.toLowerCase().contains(searchLower)) {
            return true;
        }

        // Check role from NPCEntity component
        String role = extractRole(entity);
        if (role != null && role.toLowerCase().contains(searchLower)) {
            return true;
        }

        // Check modelAssetId
        String modelAssetId = entity.getModelAssetId();
        if (modelAssetId != null && modelAssetId.toLowerCase().contains(searchLower)) {
            return true;
        }

        return false;
    }

    // ═══════════════════════════════════════════════════════════════
    // EXTRACTION METHODS
    // ═══════════════════════════════════════════════════════════════

    private EntitySummary toSummary(EntitySnapshot entity) {
        return EntitySummary.fromSnapshot(
            entity,
            extractName(entity),
            extractRole(entity)
        );
    }

    private String extractName(EntitySnapshot entity) {
        ComponentData npcEntity = entity.getComponent("NPCEntity");
        if (npcEntity == null) {
            return null;
        }

        Object name = npcEntity.getField("name");
        return name != null ? name.toString() : null;
    }

    private String extractRole(EntitySnapshot entity) {
        ComponentData npcEntity = entity.getComponent("NPCEntity");
        if (npcEntity == null) {
            return null;
        }

        Object role = npcEntity.getField("role");
        if (role == null) {
            return null;
        }

        // Role might be an object reference, try to get the path
        if (role instanceof Map<?, ?> roleMap) {
            Object path = roleMap.get("path");
            if (path != null) {
                return path.toString();
            }
        }

        return role.toString();
    }

    @SuppressWarnings("unchecked")
    private List<TimerInfo> extractTimers(EntitySnapshot entity) {
        ComponentData timersComponent = entity.getComponent("Timers");
        if (timersComponent == null) {
            return Collections.emptyList();
        }

        Object timersField = timersComponent.getField("timers");
        if (!(timersField instanceof List<?> timersList)) {
            return Collections.emptyList();
        }

        List<TimerInfo> result = new ArrayList<>();
        int index = 0;
        for (Object timerObj : timersList) {
            if (timerObj instanceof Map<?, ?> timerMap) {
                TimerInfo info = parseTimerMap((Map<String, Object>) timerMap, index);
                if (info != null) {
                    result.add(info);
                }
            }
            index++;
        }

        return result;
    }

    private TimerInfo parseTimerMap(Map<String, Object> timerMap, int index) {
        // Extract timer fields
        String state = getStringField(timerMap, "state", "STOPPED");
        double value = getDoubleField(timerMap, "value", 0.0);
        double maxValue = getDoubleField(timerMap, "maxValue", 0.0);
        double rate = getDoubleField(timerMap, "rate", 1.0);
        boolean repeating = getBooleanField(timerMap, "repeating", false);

        return new TimerInfo(index, state, value, maxValue, rate, repeating);
    }

    @SuppressWarnings("unchecked")
    private Map<String, AlarmInfo> extractAlarms(EntitySnapshot entity) {
        Map<String, AlarmInfo> result = new LinkedHashMap<>();

        // Primary location: InteractionManager.entity.alarmStore.parameters.{alarmName}
        ComponentData interactionManager = entity.getComponent("InteractionManager");
        if (interactionManager != null) {
            Object entityField = interactionManager.getField("entity");
            if (entityField instanceof Map<?, ?> entityMap) {
                Object alarmStore = ((Map<?, ?>) entityMap).get("alarmStore");
                if (alarmStore instanceof Map<?, ?> alarmStoreMap) {
                    Object parameters = ((Map<?, ?>) alarmStoreMap).get("parameters");
                    if (parameters instanceof Map<?, ?> parametersMap) {
                        for (Map.Entry<?, ?> entry : parametersMap.entrySet()) {
                            String alarmName = entry.getKey().toString();
                            if (entry.getValue() instanceof Map<?, ?> alarmData) {
                                AlarmInfo info = parseAlarmFromStore(alarmName, (Map<String, Object>) alarmData);
                                if (info != null) {
                                    result.put(alarmName, info);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Fallback: Check NPCEntity for alarms (older structure)
        ComponentData npcEntity = entity.getComponent("NPCEntity");
        if (npcEntity != null) {
            Object entityField = npcEntity.getField("entity");
            if (entityField instanceof Map<?, ?> entityMap) {
                Object alarmStore = ((Map<?, ?>) entityMap).get("alarmStore");
                if (alarmStore instanceof Map<?, ?> alarmStoreMap) {
                    Object parameters = ((Map<?, ?>) alarmStoreMap).get("parameters");
                    if (parameters instanceof Map<?, ?> parametersMap) {
                        for (Map.Entry<?, ?> entry : parametersMap.entrySet()) {
                            String alarmName = entry.getKey().toString();
                            if (!result.containsKey(alarmName) && entry.getValue() instanceof Map<?, ?> alarmData) {
                                AlarmInfo info = parseAlarmFromStore(alarmName, (Map<String, Object>) alarmData);
                                if (info != null) {
                                    result.put(alarmName, info);
                                }
                            }
                        }
                    }
                }
            }

            // Fallback: Direct alarms field on NPCEntity
            Object alarmsField = npcEntity.getField("alarms");
            if (alarmsField instanceof Map<?, ?> alarmsMap) {
                for (Map.Entry<?, ?> entry : alarmsMap.entrySet()) {
                    String alarmName = entry.getKey().toString();
                    if (!result.containsKey(alarmName) && entry.getValue() instanceof Map<?, ?> alarmData) {
                        AlarmInfo info = parseAlarmMap(alarmName, (Map<String, Object>) alarmData);
                        if (info != null) {
                            result.put(alarmName, info);
                        }
                    }
                }
            }
        }

        // Also check for dedicated Alarms component
        ComponentData alarmsComponent = entity.getComponent("Alarms");
        if (alarmsComponent != null) {
            Object alarmsField = alarmsComponent.getField("alarms");
            if (alarmsField instanceof Map<?, ?> alarmsMap) {
                for (Map.Entry<?, ?> entry : alarmsMap.entrySet()) {
                    String alarmName = entry.getKey().toString();
                    if (!result.containsKey(alarmName) && entry.getValue() instanceof Map<?, ?> alarmData) {
                        AlarmInfo info = parseAlarmMap(alarmName, (Map<String, Object>) alarmData);
                        if (info != null) {
                            result.put(alarmName, info);
                        }
                    }
                }
            }
        }

        // Check PersistentParameters for alarm data
        ComponentData persistentParams = entity.getComponent("PersistentParameters");
        if (persistentParams != null) {
            // Look for alarm-related keys in persistent parameters
            Map<String, Object> fields = persistentParams.getFields();
            for (Map.Entry<String, Object> entry : fields.entrySet()) {
                String key = entry.getKey();
                if (key.contains("Alarm") || key.contains("alarm")) {
                    if (!result.containsKey(key)) {
                        if (entry.getValue() instanceof Map<?, ?> alarmData) {
                            AlarmInfo info = parseAlarmMap(key, (Map<String, Object>) alarmData);
                            if (info != null) {
                                result.put(key, info);
                            }
                        } else if (entry.getValue() instanceof Number timestamp) {
                            // Alarm stored as timestamp
                            long scheduledMs = timestamp.longValue();
                            long remainingMs = scheduledMs - System.currentTimeMillis();
                            String state = remainingMs > 0 ? AlarmInfo.STATE_SET : AlarmInfo.STATE_PASSED;
                            double remainingSec = remainingMs > 0 ? remainingMs / 1000.0 : 0.0;
                            result.put(key, new AlarmInfo(
                                key,
                                state,
                                Instant.ofEpochMilli(scheduledMs).toString(),
                                remainingSec
                            ));
                        }
                    }
                }
            }
        }

        return result;
    }

    /**
     * Parse alarm data from the alarmStore.parameters structure.
     * This handles the nested structure: NPCEntity.entity.alarmStore.parameters.{alarmName}
     */
    private AlarmInfo parseAlarmFromStore(String name, Map<String, Object> alarmMap) {
        // Check if this is an expandable placeholder
        Object expandable = alarmMap.get("_expandable");
        if (Boolean.TRUE.equals(expandable)) {
            // Alarm exists but needs expansion - we know it's SET because it has data
            return new AlarmInfo(name, AlarmInfo.STATE_SET, null, null);
        }

        // Try to extract alarm state fields
        // Alarms typically have: isSet, hasPassed, alarmInstant
        Boolean isSet = null;
        Boolean hasPassed = null;
        Object isSetObj = alarmMap.get("isSet");
        Object hasPassedObj = alarmMap.get("hasPassed");

        if (isSetObj instanceof Boolean b) {
            isSet = b;
        }
        if (hasPassedObj instanceof Boolean b) {
            hasPassed = b;
        }

        // Determine state
        String state;
        if (Boolean.TRUE.equals(hasPassed)) {
            state = AlarmInfo.STATE_PASSED;
        } else if (Boolean.TRUE.equals(isSet)) {
            state = AlarmInfo.STATE_SET;
        } else if (isSet != null || hasPassed != null) {
            state = AlarmInfo.STATE_UNSET;
        } else {
            // Unknown structure, assume set if we have data
            state = AlarmInfo.STATE_SET;
        }

        // Try to extract scheduled time
        String scheduledTime = null;
        Double remainingSeconds = null;

        // Get current game time for calculating remaining
        Long currentGameTimeMs = getCurrentGameTimeMillis();

        Object alarmInstant = alarmMap.get("alarmInstant");
        if (alarmInstant instanceof Map<?, ?> instantMap) {
            Object epochMilli = ((Map<?, ?>) instantMap).get("epochMilli");
            if (epochMilli instanceof Number n) {
                long scheduledMs = n.longValue();
                scheduledTime = Instant.ofEpochMilli(scheduledMs).toString();

                // Calculate remaining using game time, not wall-clock time
                if (currentGameTimeMs != null) {
                    long remainingMs = scheduledMs - currentGameTimeMs;
                    remainingSeconds = remainingMs > 0 ? toRealSeconds(remainingMs / 1000.0) : 0.0;
                }
            }
        } else if (alarmInstant instanceof Number n) {
            long scheduledMs = n.longValue();
            scheduledTime = Instant.ofEpochMilli(scheduledMs).toString();

            if (currentGameTimeMs != null) {
                long remainingMs = scheduledMs - currentGameTimeMs;
                remainingSeconds = remainingMs > 0 ? toRealSeconds(remainingMs / 1000.0) : 0.0;
            }
        }

        // Also check for direct timestamp field
        Object timestamp = alarmMap.get("timestamp");
        if (timestamp instanceof Number n && scheduledTime == null) {
            long scheduledMs = n.longValue();
            scheduledTime = Instant.ofEpochMilli(scheduledMs).toString();

            if (currentGameTimeMs != null) {
                long remainingMs = scheduledMs - currentGameTimeMs;
                remainingSeconds = remainingMs > 0 ? toRealSeconds(remainingMs / 1000.0) : 0.0;
            }
        }

        return new AlarmInfo(name, state, scheduledTime, remainingSeconds);
    }

    private AlarmInfo parseAlarmMap(String name, Map<String, Object> alarmMap) {
        String state = getStringField(alarmMap, "state", AlarmInfo.STATE_UNSET);
        String scheduledTime = getStringField(alarmMap, "scheduledTime", null);

        // Try to get remaining time
        Double remainingSeconds = null;
        Object remaining = alarmMap.get("remainingSeconds");
        if (remaining instanceof Number n) {
            remainingSeconds = n.doubleValue();
        } else {
            // Calculate from scheduledTime if available
            Object timestamp = alarmMap.get("timestamp");
            if (timestamp instanceof Number ts) {
                long scheduledMs = ts.longValue();
                long remainingMs = scheduledMs - System.currentTimeMillis();
                remainingSeconds = remainingMs > 0 ? toRealSeconds(remainingMs / 1000.0) : 0.0;
                if (scheduledTime == null) {
                    scheduledTime = Instant.ofEpochMilli(scheduledMs).toString();
                }
            }
        }

        return new AlarmInfo(name, state, scheduledTime, remainingSeconds);
    }

    // ═══════════════════════════════════════════════════════════════
    // TIMER/ALARM SEARCH HELPERS
    // ═══════════════════════════════════════════════════════════════

    private boolean hasTimerInState(EntitySnapshot entity, String state) {
        List<TimerInfo> timers = extractTimers(entity);
        if (timers.isEmpty()) {
            return false;
        }

        if (state == null || state.isBlank()) {
            return true; // Any timer
        }

        String normalizedState = state.toUpperCase();
        return timers.stream().anyMatch(t -> normalizedState.equals(t.state()));
    }

    private boolean hasMatchingAlarm(EntitySnapshot entity, String alarmName, String state) {
        Map<String, AlarmInfo> alarms = extractAlarms(entity);
        if (alarms.isEmpty()) {
            return false;
        }

        if (alarmName == null || alarmName.isBlank()) {
            // Match any alarm with specified state
            if (state == null || state.isBlank()) {
                return true;
            }
            String normalizedState = state.toUpperCase();
            return alarms.values().stream().anyMatch(a -> normalizedState.equals(a.state()));
        }

        // Look for specific alarm
        String searchName = alarmName.toLowerCase();
        for (Map.Entry<String, AlarmInfo> entry : alarms.entrySet()) {
            if (entry.getKey().toLowerCase().contains(searchName)) {
                if (state == null || state.isBlank()) {
                    return true;
                }
                if (state.equalsIgnoreCase(entry.getValue().state())) {
                    return true;
                }
            }
        }

        return false;
    }

    // ═══════════════════════════════════════════════════════════════
    // UTILITY METHODS
    // ═══════════════════════════════════════════════════════════════

    private String getStringField(Map<?, ?> map, String key, String defaultValue) {
        Object value = map.get(key);
        return value != null ? value.toString() : defaultValue;
    }

    private double getDoubleField(Map<?, ?> map, String key, double defaultValue) {
        Object value = map.get(key);
        if (value instanceof Number n) {
            return n.doubleValue();
        }
        return defaultValue;
    }

    private boolean getBooleanField(Map<?, ?> map, String key, boolean defaultValue) {
        Object value = map.get(key);
        if (value instanceof Boolean b) {
            return b;
        }
        return defaultValue;
    }
}
