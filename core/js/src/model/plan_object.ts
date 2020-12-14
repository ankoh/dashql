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
/// A span in the core module
export interface CoreMemory { address: number; size: number; }

/// A plan object
export class PlanObject {
    /// The object id
    _object_id: PlanObjectID;
    /// The type
    _object_type: PlanObjectType;
    /// The time when the object was created
    _time_created: Date;
    /// The time when the object was updated
    _time_updated: Date;
    /// The short name (if any)
    _name_qualified: string;
    /// The short name (if any)
    _name_short: string;

    constructor(object_id: PlanObjectID, type: PlanObjectType, name_qualified: string, name_short: string) {
        this._object_id = object_id;
        this._object_type = type;
        this._time_created = new Date();
        this._time_updated = new Date();
        this._name_qualified = name_qualified;
        this._name_short = name_short;
    }

    /// Get the object id
    public get object_id(): PlanObjectID { return this._object_id; }
    /// Get the core buffer, if any
    public get core_memory(): CoreMemory  | null { return null; }
}

// Buffer that is directly copied into the core module
export class CoreBuffer extends PlanObject {
    /// The offset within the core module
    buffer_: CoreMemory;

    constructor(object_id: PlanObjectID, type: PlanObjectType, name_qualified: string, name_short: string, buffer: CoreMemory) {
        super(object_id, type, name_qualified, name_short);
        this.buffer_ = buffer;
    }

    /// Get the core buffer (if any)
    public get core_memory(): CoreMemory  | null {
        return this.buffer_;
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
export class ZipArchive extends JSBuffer {
    constructor(object_id: PlanObjectID, name_qualified: string, name_short: string, buffer: Uint8Array) {
        super(object_id, PlanObjectType.ARCHIVE_ZIP, name_qualified, name_short, buffer);
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
export class ParquetBlob extends JSBuffer {
    constructor(object_id: PlanObjectID, name_qualified: string, name_short: string, buffer: Uint8Array) {
        super(object_id, PlanObjectType.BLOB_PARQUET, name_qualified, name_short, buffer);
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
