import type { StorageMigrationStep } from '../storage_migration.js';
import { readManifestJson, writeManifestJson } from '../storage_root.js';
import { renameSidbConnections } from '../session/v10_dbcom_connector.js';

/// The Database.com connector was called SIDB.
///
/// Up to storage version 7 the connections of the app manifest keep its params under the key `sidb`, the step moves
/// them to the key `dbcom`. The session format version 10 does the same for the connections of the sessions.
export const dbcomConnector: StorageMigrationStep = {
    version: 8,
    description: 'Rename the connection params of the SIDB connector to dbcom',
    async migrate({ root }) {
        const manifest = await readManifestJson(root);
        if (manifest == null || !Array.isArray(manifest.connections)) {
            return;
        }
        await writeManifestJson(root, { ...manifest, connections: renameSidbConnections(manifest.connections) });
    },
};
