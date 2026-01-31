package com.laits.inspector.component;

import com.hypixel.hytale.codec.Codec;
import com.hypixel.hytale.codec.KeyedCodec;
import com.hypixel.hytale.codec.builder.BuilderCodec;
import com.hypixel.hytale.component.Component;
import com.hypixel.hytale.component.ComponentType;
import com.hypixel.hytale.server.core.universe.world.storage.EntityStore;

import javax.annotation.Nullable;

/**
 * ECS Component for storing inspector-related data on entities.
 * Data is automatically persisted by the game's ECS system.
 *
 * Currently stores:
 * - surname: Custom name set via the inspector UI
 */
public class LaitInspectorComponent implements Component<EntityStore> {

    public static final BuilderCodec<LaitInspectorComponent> CODEC = BuilderCodec.builder(
            LaitInspectorComponent.class, LaitInspectorComponent::new)
            .append(new KeyedCodec<>("Surname", Codec.STRING),
                    (data, value) -> data.surname = value,
                    data -> data.surname)
            .add()
            .build();

    // Stored by the plugin after registration
    private static ComponentType<EntityStore, LaitInspectorComponent> componentType;

    public static void setComponentType(ComponentType<EntityStore, LaitInspectorComponent> type) {
        componentType = type;
    }

    public static ComponentType<EntityStore, LaitInspectorComponent> getComponentType() {
        return componentType;
    }

    private String surname = null;

    public String getSurname() {
        return surname;
    }

    public void setSurname(String surname) {
        this.surname = surname;
    }

    public boolean hasSurname() {
        return surname != null && !surname.isEmpty();
    }

    @Nullable
    @Override
    public Component<EntityStore> clone() {
        LaitInspectorComponent component = new LaitInspectorComponent();
        component.surname = this.surname;
        return component;
    }
}
