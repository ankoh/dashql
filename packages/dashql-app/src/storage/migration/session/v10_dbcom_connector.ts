import type { SessionMigrationStep } from '../session_migration.js';

/// Rename the `sidb` key of the `params` and the `paramsDraft` of stored connections to `dbcom`.
/// Returns the connections unchanged if none of them has the key, sessions and the app manifest share the shape.
export function renameSidbConnections(connections: unknown[]): unknown[] {
    const renamed = (params: unknown) => {
        if (params == null || typeof params !== 'object' || !('sidb' in params)) return params;
        const { sidb, ...rest } = params as Record<string, unknown>;
        return { ...rest, dbcom: sidb };
    };
    return connections.map(connection => {
        if (connection == null || typeof connection !== 'object') return connection;
        const entry = connection as Record<string, unknown>;
        return {
            ...entry,
            ...('params' in entry ? { params: renamed(entry.params) } : {}),
            ...('paramsDraft' in entry ? { paramsDraft: renamed(entry.paramsDraft) } : {}),
        };
    });
}

/// The Database.com connector was called SIDB.
///
/// Up to version 9 the connections of its sessions keep their params under the key `sidb`, the step moves them to
/// the key `dbcom`.
export const dbcomConnector: SessionMigrationStep = {
    version: 10,
    description: 'Rename the connection params of the SIDB connector to dbcom',
    async migrate(folder) {
        const text = await folder.readText('dashql-session.json');
        if (text == null) return;
        const data = JSON.parse(text) as Record<string, unknown>;
        if (!Array.isArray(data.connections)) return;
        data.connections = renameSidbConnections(data.connections);
        await folder.writeText('dashql-session.json', JSON.stringify(data, null, 2));
    },
};
