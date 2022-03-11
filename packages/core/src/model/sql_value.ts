import * as proto from '@dashql/proto';

export interface SQLType {
    typeId: proto.sql.SQLTypeID;
    width: number;
    scale: number;
}

export enum PhysicalType {
    NULL,
    F64,
    STRING,
}

export interface SQLValue {
    logicalType: SQLType;
    phyiscalType: PhysicalType;
    dataF64: number;
    dataStr: string;
}
