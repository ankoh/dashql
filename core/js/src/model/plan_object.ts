
enum PlanObjectType {
    ARCHIVE_ZIP,
    BLOB,
    BLOB_PARQUET,
    DATABASE_TABLE,
    DATABASE_VIEW,
    VIZ_SPEC,
    VIZ_DATA,
}

export class PlanObject {
    /// The type
    type_: PlanObjectType;
    /// The short name (if any)
    name_short_: string;
    /// The short name (if any)
    name_qualified_: string;

    constructor(type: PlanObjectType, name_short: string, name_qualified: string) {
        this.type_ = type;
        this.name_short_ = name_short;
        this.name_qualified_ = name_qualified;
    }
}


