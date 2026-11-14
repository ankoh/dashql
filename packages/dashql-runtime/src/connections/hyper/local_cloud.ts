// The local cloud: a connection of the embedded Hyper whose session attaches a database of the clouds folder of the
// OPFS of the app, like a connection to a Hyper server that attaches the database of DashQL. See docs/design/cloud.md.
import { HYPER_CLOUDS_DIRECTORY } from '../../platform/hyperdb/hyperdb_opfs_instance.js';

/// The database file of the local cloud in the OPFS folder of the app, attached as "dashql". Deleting the connection of
/// the local cloud drops it, the next local cloud starts empty.
export const LOCAL_CLOUD_DATABASE = { path: `${HYPER_CLOUDS_DIRECTORY}/local.hyper`, alias: 'dashql' };

/// The params of a Hyper connection as far as the local cloud cares
export interface HyperParamsLike {
    protocol?: string;
    attachedDatabases?: readonly { path?: string; alias?: string }[];
}

/// The databases of the clouds folder that a connection of the embedded Hyper attaches. A connection that attaches one
/// is a connection of its own, not the embedded Hyper of the app. The embedded Hyper ignores its other attached
/// databases, as it always did.
export function embeddedCloudDatabases(hyper: HyperParamsLike | null | undefined): { path: string; alias: string }[] {
    if (hyper == null || (hyper.protocol ?? 'WASM') !== 'WASM') return [];
    return (hyper.attachedDatabases ?? [])
        .filter(database => database.path?.startsWith(`${HYPER_CLOUDS_DIRECTORY}/`) && database.alias)
        .map(database => ({ path: database.path!, alias: database.alias! }));
}
