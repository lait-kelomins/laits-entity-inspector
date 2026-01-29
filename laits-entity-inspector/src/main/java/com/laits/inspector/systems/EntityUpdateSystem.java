package com.laits.inspector.systems;

import com.hypixel.hytale.component.*;
import com.hypixel.hytale.component.query.Query;
import com.hypixel.hytale.component.system.tick.EntityTickingSystem;
import com.hypixel.hytale.server.core.entity.UUIDComponent;
import com.hypixel.hytale.server.core.modules.entity.component.TransformComponent;
import com.hypixel.hytale.server.core.universe.world.storage.EntityStore;
import com.hypixel.hytale.math.vector.Vector3d;
import com.laits.inspector.core.EntityDataCollector.CollectionResult;
import com.laits.inspector.core.InspectorCore;
import com.laits.inspector.data.PositionUpdate;

import javax.annotation.Nonnull;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * ECS EntityTickingSystem that detects entity component changes.
 * Uses periodic polling since Hytale has no built-in change detection.
 */
public class EntityUpdateSystem extends EntityTickingSystem<EntityStore> {

    private static final ComponentType<EntityStore, TransformComponent> TRANSFORM_TYPE = TransformComponent.getComponentType();
    private static final ComponentType<EntityStore, UUIDComponent> UUID_TYPE = UUIDComponent.getComponentType();

    // Position tracking for change detection
    private static class TrackedPosition {
        double x, y, z;
        float yaw, pitch;
        long lastFullUpdate;

        boolean positionChanged(double nx, double ny, double nz, double threshold) {
            return Math.abs(x - nx) > threshold ||
                   Math.abs(y - ny) > threshold ||
                   Math.abs(z - nz) > threshold;
        }

        void update(double nx, double ny, double nz, float nyaw, float npitch) {
            x = nx;
            y = ny;
            z = nz;
            yaw = nyaw;
            pitch = npitch;
        }
    }

    private final InspectorCore core;
    private final Query<EntityStore> query;
    private final Map<Long, TrackedPosition> trackedPositions = new ConcurrentHashMap<>();

    // Batch position updates for efficiency
    private final List<PositionUpdate> positionBatch = new ArrayList<>();

    private int tickCounter = 0;
    private int fullUpdateCounter = 0;

    // Position change threshold (in blocks)
    private static final double POSITION_THRESHOLD = 0.01;

    // Full update interval (every N update intervals, do a full component check)
    private static final int FULL_UPDATE_MULTIPLIER = 10;

    public EntityUpdateSystem(InspectorCore core) {
        this.core = core;
        // Query for entities with TransformComponent
        this.query = TRANSFORM_TYPE;
    }

    @Nonnull
    @Override
    public Query<EntityStore> getQuery() {
        return query;
    }

    @Override
    public void tick(float dt, int index, @Nonnull ArchetypeChunk<EntityStore> chunk,
                     @Nonnull Store<EntityStore> store, @Nonnull CommandBuffer<EntityStore> commandBuffer) {
        if (!core.isEnabled() || core.isPaused()) {
            return;
        }

        // Only process at configured intervals
        tickCounter++;
        if (tickCounter < core.getUpdateIntervalTicks()) {
            return;
        }
        tickCounter = 0;

        try {
            Ref<EntityStore> entityRef = chunk.getReferenceTo(index);
            if (entityRef == null) {
                return;
            }

            long entityId = entityRef.getIndex();

            // Get current position
            TransformComponent transform = chunk.getComponent(index, TRANSFORM_TYPE);
            if (transform == null) {
                return;
            }

            Vector3d pos = transform.getPosition();
            if (pos == null) {
                return;
            }

            // Check if position changed
            TrackedPosition tracked = trackedPositions.computeIfAbsent(entityId, k -> new TrackedPosition());
            boolean posChanged = tracked.positionChanged(pos.getX(), pos.getY(), pos.getZ(), POSITION_THRESHOLD);

            if (posChanged) {
                // Get UUID for position update
                String uuid = null;
                UUIDComponent uuidComp = chunk.getComponent(index, UUID_TYPE);
                if (uuidComp != null && uuidComp.getUuid() != null) {
                    uuid = uuidComp.getUuid().toString();
                }

                // Add to position batch
                positionBatch.add(new PositionUpdate(entityId, uuid, pos.getX(), pos.getY(), pos.getZ(), 0, 0));

                tracked.update(pos.getX(), pos.getY(), pos.getZ(), 0, 0);
            }

            // Periodically do full component updates
            fullUpdateCounter++;
            if (fullUpdateCounter >= FULL_UPDATE_MULTIPLIER) {
                fullUpdateCounter = 0;

                long now = System.currentTimeMillis();
                if (now - tracked.lastFullUpdate > 1000) { // At least 1 second between full updates
                    tracked.lastFullUpdate = now;

                    CollectionResult result = core.getCollector().collectFromChunkWithRefs(chunk, index);
                    if (result != null && result.snapshot() != null) {
                        core.onEntityUpdate(result.snapshot(), result.componentRefs());
                    }
                }
            }
        } catch (Exception e) {
            // Silent - don't crash the tick system
        }
    }

    /**
     * Called at the end of each world tick to flush batched updates.
     * Should be called from the plugin's tick handler.
     */
    public void flushPositionBatch() {
        if (!positionBatch.isEmpty()) {
            core.onPositionBatch(new ArrayList<>(positionBatch));
            positionBatch.clear();
        }
    }

    /**
     * Clean up tracking for despawned entities.
     */
    public void onEntityDespawn(long entityId) {
        trackedPositions.remove(entityId);
    }
}
