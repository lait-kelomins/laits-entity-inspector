package com.laits.inspector.core;

import com.hypixel.hytale.component.*;
import com.hypixel.hytale.math.vector.Vector3d;
import com.hypixel.hytale.server.core.asset.type.model.config.Model;
import com.hypixel.hytale.server.core.entity.UUIDComponent;
import com.hypixel.hytale.server.core.modules.entity.component.ModelComponent;
import com.hypixel.hytale.server.core.modules.entity.component.TransformComponent;
import com.hypixel.hytale.server.core.universe.world.World;
import com.hypixel.hytale.server.core.universe.world.storage.EntityStore;
import com.hypixel.hytale.server.npc.entities.NPCEntity;
import com.laits.inspector.config.InspectorConfig;
import com.laits.inspector.data.ComponentData;
import com.laits.inspector.data.EntitySnapshot;
import com.laits.inspector.data.WorldSnapshot;

import javax.annotation.Nonnull;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Collects entity data from the ECS system.
 * All methods must be called from the world thread (via world.execute() or ECS system callbacks).
 */
public class EntityDataCollector {

    // Cached component types for performance
    private static final ComponentType<EntityStore, TransformComponent> TRANSFORM_TYPE = TransformComponent.getComponentType();
    private static final ComponentType<EntityStore, ModelComponent> MODEL_TYPE = ModelComponent.getComponentType();
    private static final ComponentType<EntityStore, UUIDComponent> UUID_TYPE = UUIDComponent.getComponentType();
    private static final ComponentType<EntityStore, NPCEntity> NPC_TYPE = NPCEntity.getComponentType();

    private final ComponentSerializer serializer;
    private final InspectorConfig config;

    public EntityDataCollector(InspectorConfig config) {
        this.config = config;
        this.serializer = new ComponentSerializer();
    }

    /**
     * Collect a full world snapshot.
     * MUST be called from world thread.
     */
    public WorldSnapshot collectWorldSnapshot(World world) {
        if (world == null) {
            return WorldSnapshot.builder().build();
        }

        EntityStore entityStore = world.getEntityStore();
        if (entityStore == null) {
            return WorldSnapshot.builder().build();
        }

        Store<EntityStore> store = entityStore.getStore();
        if (store == null) {
            return WorldSnapshot.builder().build();
        }

        List<EntitySnapshot> entities = new ArrayList<>();

        store.forEachChunk((ArchetypeChunk<EntityStore> chunk, CommandBuffer<EntityStore> buffer) -> {
            int size = chunk.size();
            for (int i = 0; i < size; i++) {
                EntitySnapshot snapshot = collectFromChunk(chunk, i);
                if (snapshot != null && shouldInclude(snapshot)) {
                    entities.add(snapshot);
                }
            }
        });

        return WorldSnapshot.builder()
                .worldId(world.getName())  // Use name as ID since getUuid may not exist
                .worldName(world.getName())
                .entities(entities)
                .build();
    }

    /**
     * Collect a snapshot of a single entity from a chunk.
     * MUST be called from world thread.
     */
    public EntitySnapshot collectFromChunk(ArchetypeChunk<EntityStore> chunk, int index) {
        try {
            Ref<EntityStore> entityRef = chunk.getReferenceTo(index);
            if (entityRef == null) {
                return null;
            }

            EntitySnapshot.Builder builder = EntitySnapshot.builder();

            // Entity ID from ref index
            builder.entityId(entityRef.getIndex());

            // UUID
            UUIDComponent uuidComp = chunk.getComponent(index, UUID_TYPE);
            if (uuidComp != null && uuidComp.getUuid() != null) {
                builder.uuid(uuidComp.getUuid().toString());
            } else {
                builder.uuid(UUID.randomUUID().toString());
            }

            // Transform (position/rotation)
            TransformComponent transform = chunk.getComponent(index, TRANSFORM_TYPE);
            if (transform != null) {
                Vector3d pos = transform.getPosition();
                if (pos != null) {
                    builder.position(pos.getX(), pos.getY(), pos.getZ());
                }
                // Add transform as component data too
                ComponentData transformData = serializer.serialize(transform);
                if (transformData != null) {
                    builder.addComponent("TransformComponent", transformData);
                }
            }

            // Model
            ModelComponent modelComp = chunk.getComponent(index, MODEL_TYPE);
            if (modelComp != null) {
                Model model = modelComp.getModel();
                if (model != null) {
                    builder.modelAssetId(model.getModelAssetId());
                }
                ComponentData modelData = serializer.serialize(modelComp);
                if (modelData != null) {
                    builder.addComponent("ModelComponent", modelData);
                }
            }

            // NPC entity type
            NPCEntity npc = chunk.getComponent(index, NPC_TYPE);
            if (npc != null) {
                builder.entityType("NPC");
                ComponentData npcData = serializer.serialize(npc);
                if (npcData != null) {
                    builder.addComponent("NPCEntity", npcData);
                }
            }

            // Collect all other components from archetype
            collectAllComponents(chunk, index, builder);

            return builder.build();
        } catch (Exception e) {
            return null;
        }
    }

    // Component types already handled explicitly
    private static final Set<String> HANDLED_COMPONENTS = Set.of(
            "TransformComponent", "ModelComponent", "UUIDComponent", "NPCEntity"
    );

    /**
     * Collect all components from the archetype that aren't already handled.
     */
    @SuppressWarnings({"unchecked", "rawtypes"})
    private void collectAllComponents(ArchetypeChunk<EntityStore> chunk, int index, EntitySnapshot.Builder builder) {
        try {
            Archetype<EntityStore> archetype = chunk.getArchetype();
            if (archetype == null) {
                return;
            }

            for (int i = archetype.getMinIndex(); i < archetype.length(); i++) {
                ComponentType type = archetype.get(i);
                if (type == null) {
                    continue;
                }

                Object component = chunk.getComponent(index, type);
                if (component == null) {
                    continue;
                }

                String typeName = component.getClass().getSimpleName();

                // Skip already-handled components
                if (HANDLED_COMPONENTS.contains(typeName)) {
                    continue;
                }

                ComponentData data = serializer.serialize(component);
                if (data != null) {
                    builder.addComponent(typeName, data);
                }
            }
        } catch (Exception e) {
            // Silent - archetype access may fail for some entities
        }
    }

    /**
     * Collect a snapshot of a single entity from a Holder.
     * MUST be called from world thread.
     */
    public EntitySnapshot collectFromHolder(@Nonnull Holder<EntityStore> holder, Store<EntityStore> store) {
        try {
            EntitySnapshot.Builder builder = EntitySnapshot.builder();

            // UUID - use as primary identifier
            UUIDComponent uuidComp = holder.getComponent(UUID_TYPE);
            String uuidStr;
            if (uuidComp != null && uuidComp.getUuid() != null) {
                uuidStr = uuidComp.getUuid().toString();
            } else {
                uuidStr = UUID.randomUUID().toString();
            }
            builder.uuid(uuidStr);
            // Use UUID hashcode as entity ID
            builder.entityId(uuidStr.hashCode());

            // Transform
            TransformComponent transform = holder.getComponent(TRANSFORM_TYPE);
            if (transform != null) {
                Vector3d pos = transform.getPosition();
                if (pos != null) {
                    builder.position(pos.getX(), pos.getY(), pos.getZ());
                }
                ComponentData transformData = serializer.serialize(transform);
                if (transformData != null) {
                    builder.addComponent("TransformComponent", transformData);
                }
            }

            // Model
            ModelComponent modelComp = holder.getComponent(MODEL_TYPE);
            if (modelComp != null) {
                Model model = modelComp.getModel();
                if (model != null) {
                    builder.modelAssetId(model.getModelAssetId());
                }
                ComponentData modelData = serializer.serialize(modelComp);
                if (modelData != null) {
                    builder.addComponent("ModelComponent", modelData);
                }
            }

            // NPC
            NPCEntity npc = holder.getComponent(NPC_TYPE);
            if (npc != null) {
                builder.entityType("NPC");
                ComponentData npcData = serializer.serialize(npc);
                if (npcData != null) {
                    builder.addComponent("NPCEntity", npcData);
                }
            }

            // Collect all other components from holder's archetype
            collectAllComponentsFromHolder(holder, store, builder);

            return builder.build();
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Collect all components from a Holder that aren't already handled.
     */
    @SuppressWarnings({"unchecked", "rawtypes"})
    private void collectAllComponentsFromHolder(Holder<EntityStore> holder, Store<EntityStore> store, EntitySnapshot.Builder builder) {
        try {
            Archetype<EntityStore> archetype = holder.getArchetype();
            if (archetype == null) {
                return;
            }

            for (int i = archetype.getMinIndex(); i < archetype.length(); i++) {
                ComponentType type = archetype.get(i);
                if (type == null) {
                    continue;
                }

                Object component = holder.getComponent(type);
                if (component == null) {
                    continue;
                }

                String typeName = component.getClass().getSimpleName();

                // Skip already-handled components
                if (HANDLED_COMPONENTS.contains(typeName)) {
                    continue;
                }

                ComponentData data = serializer.serialize(component);
                if (data != null) {
                    builder.addComponent(typeName, data);
                }
            }
        } catch (Exception e) {
            // Silent - archetype access may fail for some entities
        }
    }

    /**
     * Check if an entity should be included based on config.
     */
    private boolean shouldInclude(EntitySnapshot snapshot) {
        String type = snapshot.getEntityType();

        if ("NPC".equals(type)) {
            return config.isIncludeNPCs();
        }

        if ("Player".equals(type)) {
            return config.isIncludePlayers();
        }

        if ("Item".equals(type)) {
            return config.isIncludeItems();
        }

        // Include other types by default
        return true;
    }
}
