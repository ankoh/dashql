/// The client context of the queries of a connection that Hyper logs as ctx.client, so that its log attributes them
export interface DashQLClientContext {
    /// The fields of the app
    dashql: {
        /// The connection that the queries are attributed to
        connectionId?: string;
        /// The kind of the queries: of the user on the sessions of the connection, of computations, or of a reader of
        /// the Hyper log, e.g. the Hyper log demo
        queryType: 'user' | 'sqlframe' | 'overview' | 'monitor';
    };
}

/// The client context of the queries of the user on the sessions of a connection
export function connectionClientContext(connectionId: string): DashQLClientContext & Record<string, unknown> {
    return { dashql: { connectionId, queryType: 'user' } };
}

/// The client context that attributes the queries of a computation to the connection of its table.
/// The queries run on pooled compute connections, whose sessions are shared by all connections.
export function sqlframeClientContext(connectionId: string): DashQLClientContext & Record<string, unknown> {
    return { dashql: { connectionId, queryType: 'sqlframe' } };
}
