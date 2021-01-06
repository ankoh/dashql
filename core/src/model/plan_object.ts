// Copyright (c) 2020 The DashQL Authors

import * as proto from '@dashql/proto';
import * as webdb from '@dashql/webdb';
import { VizSpecVariant } from './viz_spec';

/// A plan object type
export enum PlanObjectType {
    DATABASE_TABLE,
    DATABASE_VIEW,
    VIZ_DATA,
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

/// A relation info
export interface RelationInfo {
    /// The column names
    columnNames: string[];
    /// The column type
    columnTypes: webdb.SQLType[];
    /// The row count
    rowCount: number;
};

/// A database table
export interface DatabaseTable extends PlanObject {
    /// The relation info
    relationInfo: RelationInfo;
};

/// A database view
export interface DatabaseView extends PlanObject {
    /// The query result
    queryResult: proto.webdb.QueryResult;
    /// The relation info
    relationInfo: RelationInfo;
};

/// A vizualisation data object
export interface VizData extends PlanObject {
    /// The spec
    spec: VizSpecVariant;
}
