
export interface StoredConnection {
    /// The connection id
    id: number;
    /// The connection params as protobuf `dashql.ConnectionParams`
    paramsBuffer: Uint8Array;
};

export interface StoredConnectionAuth {
    /// The connection id
    connectionId: number;
}

export interface StoredConnectionCatalog {
    /// The connection id
    connectionId: number;
    /// The catalog as protobuf `dashql.FlatCatalog`
    catalogBuffer: Uint8Array;
}

export interface StoredWorkbook {
    /// The workbook id
    id: number;
    /// The connection id
    connectionId: number;
    /// The workbook as protobuf `dashql.Workbook`
    workbookBuffer: Uint8Array;
}

export interface StoredWorkbookScript {
    /// The script id
    id: number;
    /// The workbook id
    workbookId: number;
    /// The script buffer
    scriptBuffer: Uint8Array;
}

export interface StoredWorkbookEntry {
    /// The entry id
    id: number;
    /// The workbook id
    workbookId: number;
    /// The script id
    scriptId: number;
    /// The entry index
    entryIndex: number;
}
