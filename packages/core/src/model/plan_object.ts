// Copyright (c) 2020 The DashQL Authors

/// A plan object type
export enum PlanObjectType {
    TABLE_SUMMARY,
    CARD_SPECIFICATION,
    UNIQUE_BLOB,
    DUCKDB_BUFFER,
}
/// A plan object id
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
    /// The qualified table name
    nameQualified: string;
}
