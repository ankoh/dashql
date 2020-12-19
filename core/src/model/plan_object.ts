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
export interface PlanObject {
    /// The object id
    objectId: PlanObjectID;
    /// The type
    objectType: PlanObjectType;
    /// The time when the object was created
    timeCreated: Date;
    /// The time when the object was updated
    timeUpdated: Date;
    /// The short name (if any)
    nameQualified: string;
    /// The short name (if any)
    nameShort: string;
}

// Buffer that remains on the JS side
interface JSBuffer extends PlanObject {
    /// The offset within the core module
    buffer: Uint8Array;
}

/// A ZIP archive.
export interface ZipArchive extends JSBuffer {
};

/// An opaque blob.
/// Opaque blobs stay on the js side since the EXTRACT statement will decide what to do with it.
export interface Blob extends JSBuffer {
};

/// A parquet blob.
/// Parquet files are copied into the core module since we can read them directly in DuckDB.
export interface ParquetBlob extends JSBuffer {
};

/// A specification for a vizualization component.
export interface VizSpec extends PlanObject {
    yet_to_be_defined_spec: any;
}
