// Copyright (c) 2021 The DashQL Authors

/// A plan object id
export type PlanObjectID = number;

/// A plan object
export interface PlanObject {
    /// The object id
    objectId: PlanObjectID;
    /// The time when the object was created
    timeCreated: Date;
    /// The time when the object was updated
    timeUpdated: Date;
    /// The qualified table name
    nameQualified: string;
}
