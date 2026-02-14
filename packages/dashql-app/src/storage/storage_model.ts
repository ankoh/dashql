// The storage model of DashQL is held deliberately simple.
//
// We store:
//  - Connections: These are the exported connection states of all connections in the app.
//  - Connection Catalogs: Catalog refreshes can be very costly (e.g. Trino) and we want to save an exported catalog on disk if we have one.
//  - Notebooks: These are the exported notebook states minus anything stored separately
//               (Connection params, Notebook scripts)
//  - Notebook Scripts: These are the actual script texts


export interface StoredConnection {
    /// The connection id
    connectionId: number;
    /// The connection details as protobuf `dashql.SalesforceConnectionDetails`
    connectionProto: Uint8Array;
};

export interface StoredConnectionCatalog {
    /// The connection id
    connectionId: number;
    /// The catalog as protobuf `dashql.Catalog`
    catalogProto: Uint8Array;
}

export interface StoredNotebook {
    /// The notebook id
    notebookId: number;
    /// The connection id.
    /// Immutable, doesn't change.
    connectionId: number;
    /// The notebook as protobuf `dashql.Notebook`.
    /// Notebook scripts are not stored as part of the protobuf.
    /// They are instead stored separately as `StoredNotebookScript`.
    notebookProto: Uint8Array;
}

/// We deliberately store the notebook script separately.
/// We'll update this entry very regularly whenever the script text changes.
/// We don't want to re-serialize the entire notebook state over and over again.
export interface StoredNotebookScript {
    /// The notebook id
    notebookId: number;
    /// The script id.
    scriptId: number;
    /// The notebook script as protobuf `dashql.NotebookScript`
    scriptProto: Uint8Array;
}
