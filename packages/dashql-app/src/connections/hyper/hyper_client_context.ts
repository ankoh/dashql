/// The client context of the queries of a connection that Hyper logs as ctx.client, so that its log attributes them
export interface DashQLClientContext {
    /// The fields of the app
    dashql: {
        /// The connection that the queries are attributed to
        connectionId?: string;
        /// The kind of the queries: of the user on the sessions of the connection, or of computations, which the core
        /// attributes to the connection of their table
        queryType: 'user' | 'sqlframe';
    };
}

/// The client context of the queries of the user on the sessions of a connection
export function connectionClientContext(connectionId: string): DashQLClientContext & Record<string, unknown> {
    return { dashql: { connectionId, queryType: 'user' } };
}
