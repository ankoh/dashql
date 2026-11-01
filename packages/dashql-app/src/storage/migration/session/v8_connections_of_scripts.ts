import type { SessionMigrationStep } from '../session_migration.js';

/// Sessions no longer have a default connection, they hold the connections their scripts use.
///
/// Version 7 named a default connection that new scripts used and that the session held even when no
/// script ran on it. The connections are reduced to the ones the scripts use, in the order the scripts
/// first use them. A session without scripts keeps its default connection, or its first connection, its
/// first script runs on it.
export const connectionsOfScripts: SessionMigrationStep = {
    version: 8,
    description: 'Hold the connections of the scripts without a default connection',
    async migrate(folder) {
        const text = await folder.readText('dashql-session.json');
        if (text == null) {
            return;
        }
        const data = JSON.parse(text) as Record<string, unknown>;
        const scripts = Array.isArray(data.scripts) ? data.scripts as unknown[] : [];
        const connections = Array.isArray(data.connections) ? data.connections as unknown[] : [];
        const scriptConnectionIds = scripts.flatMap(script => {
            const connectionId = script != null && typeof script === 'object' ? (script as Record<string, unknown>).connectionId : null;
            return typeof connectionId === 'string' ? [connectionId] : [];
        });
        const byId = new Map<string, unknown>();
        for (const connection of connections) {
            const connectionId = connection != null && typeof connection === 'object' ? (connection as Record<string, unknown>).connectionId : null;
            if (typeof connectionId === 'string' && !byId.has(connectionId)) byId.set(connectionId, connection);
        }
        const emptyConnectionId = typeof data.defaultConnectionId === 'string' && byId.has(data.defaultConnectionId)
            ? data.defaultConnectionId
            : byId.keys().next().value;
        const used = scriptConnectionIds.length > 0 ? scriptConnectionIds : emptyConnectionId == null ? [] : [emptyConnectionId];
        // A session holds at least one connection, scripts on unknown connections run on it
        let kept: unknown[] = [...new Set(used)].flatMap(connectionId => byId.has(connectionId) ? [byId.get(connectionId)] : []);
        if (kept.length === 0 && emptyConnectionId != null) kept = [byId.get(emptyConnectionId)];
        const migrated: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
            if (key === 'defaultConnectionId') continue;
            migrated[key] = key === 'connections' ? kept : value;
        }
        await folder.writeText('dashql-session.json', JSON.stringify(migrated, null, 2));
    },
};
