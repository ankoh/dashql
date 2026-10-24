import type { StorageMigrationStep } from '../storage_migration.js';
import { readManifestJson, writeManifestJson } from '../storage_root.js';

/// The connections of the app manifest list the ids of consolidated connections as `aliases` up to
/// storage version 5. The load rewrote the references of every session it restored, the step drops
/// the aliases. Sessions that still name an alias keep an unresolved connection.
export const dropConnectionAliases: StorageMigrationStep = {
    version: 6,
    description: 'Drop the aliases of the connections of the app manifest',
    async migrate({ root }) {
        const manifest = await readManifestJson(root);
        if (manifest == null || !Array.isArray(manifest.connections)) {
            return;
        }
        const connections = (manifest.connections as unknown[]).map(entry => {
            if (entry == null || typeof entry !== 'object' || !('aliases' in entry)) return entry;
            const { aliases: _aliases, ...rest } = entry as Record<string, unknown>;
            return rest;
        });
        await writeManifestJson(root, { ...manifest, connections });
    },
};
