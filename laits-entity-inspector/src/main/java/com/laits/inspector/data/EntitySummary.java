package com.laits.inspector.data;

/**
 * Compact summary of a live entity for listing purposes.
 * Contains only essential fields to minimize response size.
 */
public record EntitySummary(
    long id,
    String uuid,
    String type,
    String name,
    String role,
    double x,
    double y,
    double z
) {
    /**
     * Create from an EntitySnapshot with extracted name and role.
     */
    public static EntitySummary fromSnapshot(EntitySnapshot snapshot, String name, String role) {
        return new EntitySummary(
            snapshot.getEntityId(),
            snapshot.getUuid(),
            snapshot.getEntityType(),
            name,
            role,
            snapshot.getX(),
            snapshot.getY(),
            snapshot.getZ()
        );
    }
}
