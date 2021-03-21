// Copyright (c) 2020 The DashQL Authors

/// A plan object type
export enum PlanObjectType {
    DATABASE_TABLE_INFO,
    VIZ_INFO,
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
}