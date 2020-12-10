/// A plan object type
export enum PlanObjectType {
    ARCHIVE_ZIP,
    BLOB,
    BLOB_PARQUET,
    DATABASE_TABLE,
    DATABASE_VIEW,
    VIZ_SPEC,
}
/// A plan obbject id
export type PlanObjectID = number;

/// A plan object
export class PlanObject {
    /// The object id
    object_id_: PlanObjectID;
    /// The type
    object_type_: PlanObjectType;
    /// The time when the object was created
    time_created_: Date;
    /// The time when the object was updated
    time_updated_: Date;
    /// The short name (if any)
    name_qualified_: string;
    /// The short name (if any)
    name_short_: string;

    constructor(object_id: PlanObjectID, type: PlanObjectType, name_qualified: string, name_short: string) {
        this.object_id_ = object_id;
        this.object_type_ = type;
        this.time_created_ = new Date();
        this.time_updated_ = new Date();
        this.name_qualified_ = name_qualified;
        this.name_short_ = name_short;
    }
}

// Buffer that is directly copied into the core module
class CoreBuffer extends PlanObject {
    /// The offset within the core module
    buffer_offset_: number;
    /// The size within the core module
    buffer_size_: number;

    constructor(object_id: PlanObjectID, type: PlanObjectType, name_qualified: string, name_short: string, buffer_offset: number, buffer_size: number) {
        super(object_id, type, name_qualified, name_short);
        this.buffer_offset_ = buffer_offset;
        this.buffer_size_ = buffer_size;
    }
}

// Buffer that remains on the JS side
class JSBuffer extends PlanObject {
    /// The offset within the core module
    buffer_: Uint8Array;

    constructor(object_id: PlanObjectID, type: PlanObjectType, name_qualified: string, name_short: string, buffer: Uint8Array) {
        super(object_id, type, name_qualified, name_short);
        this.buffer_ = buffer;
    }
}

/// A ZIP archive.
/// ZIP archives are copied into the core module since we have to unpack the archive there anyway.
export class ZipArchive extends CoreBuffer {
    constructor(object_id: PlanObjectID, name_qualified: string, name_short: string, buffer_offset: number, buffer_size: number) {
        super(object_id, PlanObjectType.ARCHIVE_ZIP, name_qualified, name_short, buffer_offset, buffer_size);
    }
};

/// An opaque blob.
/// Opaque blobs stay on the js side since the EXTRACT statement will decide what to do with it.
export class Blob extends JSBuffer {
    constructor(object_id: PlanObjectID, name_qualified: string, name_short: string, buffer: Uint8Array) {
        super(object_id, PlanObjectType.BLOB, name_qualified, name_short, buffer);
    }
};

/// A parquet blob.
/// Parquet files are copied into the core module since we can read them directly in DuckDB.
export class ParquetBlob extends CoreBuffer {
    constructor(object_id: PlanObjectID, name_qualified: string, name_short: string, buffer_offset: number, buffer_size: number) {
        super(object_id, PlanObjectType.BLOB_PARQUET, name_qualified, name_short, buffer_offset, buffer_size);
    }
};

/// A specification for a vizualization component.
export class VizSpec extends PlanObject {
    yet_to_be_defined_spec: any;

    constructor(object_id: PlanObjectID, name_qualified: string, name_short: string, spec: any) {
        super(object_id, PlanObjectType.BLOB_PARQUET, name_qualified, name_short);
        this.yet_to_be_defined_spec = spec;
    }
}
