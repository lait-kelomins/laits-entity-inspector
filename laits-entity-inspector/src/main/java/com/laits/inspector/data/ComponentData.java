package com.laits.inspector.data;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Immutable container for serialized component data.
 * Holds the component type name and its field values as a Map.
 */
public final class ComponentData {
    private final String componentType;
    private final Map<String, Object> fields;

    public ComponentData(String componentType, Map<String, Object> fields) {
        this.componentType = Objects.requireNonNull(componentType, "componentType");
        this.fields = fields != null
                ? Collections.unmodifiableMap(new LinkedHashMap<>(fields))
                : Collections.emptyMap();
    }

    public String getComponentType() {
        return componentType;
    }

    public Map<String, Object> getFields() {
        return fields;
    }

    public Object getField(String name) {
        return fields.get(name);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        ComponentData that = (ComponentData) o;
        return Objects.equals(componentType, that.componentType) &&
               Objects.equals(fields, that.fields);
    }

    @Override
    public int hashCode() {
        return Objects.hash(componentType, fields);
    }

    @Override
    public String toString() {
        return "ComponentData{" +
               "componentType='" + componentType + '\'' +
               ", fields=" + fields +
               '}';
    }
}
