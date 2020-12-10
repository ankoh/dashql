enum EntityType {
    ARCHIVE_ZIP,
    BLOB,
    BLOB_PARQUET,
    TABLE,
    VIEW,
    VIZ_SPEC,
    VIZ_DATA,
}

export class Entity {
    /// The type
    type: EntityType;

    constructor(type: EntityType) {
        this.type = type;
    }
}


