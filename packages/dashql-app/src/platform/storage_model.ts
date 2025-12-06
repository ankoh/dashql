// The storage model of DashQL is held deliberately simple.
//
// We store:
//  - Connections: These are the exported connection states of all connections in the app.
//  - Connection Catalogs: Catalog refreshes can be very costly (e.g. Trino) and we want to save an exported catalog on disk if we have one.
//  - Workbooks: These are the exported workbook states minus anything stored separately
//               (Connection params, Workbook scripts)
//  - Workbook Scripts: These are the actual script texts


export interface StoredConnection {
    /// The connection id
    connectionId: number;
    /// The connection details as protobuf `dashql.SalesforceConnectionDetails`
    connectionBuffer: Uint8Array;
};

export interface StoredConnectionCatalog {
    /// The connection id
    connectionId: number;
    /// The catalog as protobuf `dashql.FlatCatalog`
    catalogBuffer: Uint8Array;
}

export interface StoredWorkbook {
    /// The workbook id
    workbookId: number;
    /// The connection id.
    /// Immutable, doesn't change.
    connectionId: number;
    /// The workbook as protobuf `dashql.Workbook`.
    /// Workbook scripts are not stored as part of the protobuf.
    /// They are instead stored separately as `StoredWorkbookScript`.
    workbookBuffer: Uint8Array;
}

/// We deliberately store the workbook script separately.
/// We'll update this entry very regularly whenever the script text changes.
/// We don't want to re-serialize the entire workbook state over and over again.
export interface StoredWorkbookScript {
    /// The script id
    scriptId: number;
    /// The workbook id
    workbookId: number;
    /// The script text
    scriptText: string;
}
