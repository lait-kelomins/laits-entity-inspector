package com.laits.inspector.systems;

import com.hypixel.hytale.component.*;
import com.hypixel.hytale.component.query.Query;
import com.hypixel.hytale.component.system.HolderSystem;
import com.hypixel.hytale.server.core.entity.UUIDComponent;
import com.hypixel.hytale.server.core.modules.entity.component.TransformComponent;
import com.hypixel.hytale.server.core.universe.world.storage.EntityStore;
import com.laits.inspector.core.InspectorCore;
import com.laits.inspector.data.EntitySnapshot;

import javax.annotation.Nonnull;

/**
 * ECS HolderSystem that tracks entity spawn and despawn events.
 * Notifies InspectorCore when entities are added or removed.
 */
public class EntityLifecycleSystem extends HolderSystem<EntityStore> {

    private static final ComponentType<EntityStore, UUIDComponent> UUID_TYPE = UUIDComponent.getComponentType();
    private static final ComponentType<EntityStore, TransformComponent> TRANSFORM_TYPE = TransformComponent.getComponentType();

    private final InspectorCore core;
    private final Query<EntityStore> query;

    public EntityLifecycleSystem(InspectorCore core) {
        this.core = core;
        // Match all entities with TransformComponent (most entities have this)
        this.query = TRANSFORM_TYPE;
    }

    @Nonnull
    @Override
    public Query<EntityStore> getQuery() {
        return query;
    }

    @Override
    public void onEntityAdd(@Nonnull Holder<EntityStore> holder, @Nonnull AddReason reason,
                            @Nonnull Store<EntityStore> store) {
        if (!core.isEnabled()) {
            return;
        }

        try {
            // Collect entity data using holder
            EntitySnapshot snapshot = core.getCollector().collectFromHolder(holder, store);
            if (snapshot != null) {
                core.onEntitySpawn(snapshot);
            }
        } catch (Exception e) {
            // Silent - don't crash the system
        }
    }

    @Override
    public void onEntityRemoved(@Nonnull Holder<EntityStore> holder, @Nonnull RemoveReason reason,
                                @Nonnull Store<EntityStore> store) {
        if (!core.isEnabled()) {
            return;
        }

        try {
            // Get UUID as entity identifier
            String uuid = null;
            UUIDComponent uuidComp = holder.getComponent(UUID_TYPE);
            if (uuidComp != null && uuidComp.getUuid() != null) {
                uuid = uuidComp.getUuid().toString();
            }

            // Use UUID hashcode as entity ID for consistency
            long entityId = uuid != null ? uuid.hashCode() : System.nanoTime();

            core.onEntityDespawn(entityId, uuid);
        } catch (Exception e) {
            // Silent
        }
    }
}
