import type { SessionMigrationStep } from '../session_migration.js';

/// Connections decide whether query results are cached, sessions have no settings.
///
/// Version 8 kept `settings.cacheQueryResults` in the session file, its only setting. The connections of the app
/// manifest hold the setting now, the step removes the settings of the session.
export const dropSessionSettings: SessionMigrationStep = {
    version: 9,
    description: 'Remove the settings of the session, connections decide whether query results are cached',
    async migrate(folder) {
        const text = await folder.readText('dashql-session.json');
        if (text == null) return;
        const data = JSON.parse(text) as Record<string, unknown>;
        if (!('settings' in data)) return;
        delete data.settings;
        await folder.writeText('dashql-session.json', JSON.stringify(data, null, 2));
    },
};
