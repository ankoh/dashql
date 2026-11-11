// The local cloud: a connection of the embedded Hyper whose session attaches a database of the clouds folder of the
// OPFS of the app, like a connection to a Hyper server that attaches the database of DashQL. See docs/design/cloud.md.

/// The database file of the local cloud in the OPFS folder of the app, attached as "dashql"
export const LOCAL_CLOUD_DATABASE = { path: 'clouds/local.hyper', alias: 'dashql' };

/// The folder of the databases that a connection of the embedded Hyper attaches
const CLOUDS_FOLDER = 'clouds/';

/// The params of a Hyper connection as far as the local cloud cares
interface HyperParamsLike {
    protocol?: string;
    attachedDatabases?: readonly { path?: string; alias?: string }[];
}

/// The databases of the clouds folder that a connection of the embedded Hyper attaches. A connection that attaches one
/// is a connection of its own, not the embedded Hyper of the app. The embedded Hyper ignores its other attached
/// databases, as it always did.
export function embeddedCloudDatabases(hyper: HyperParamsLike | null | undefined): { path: string; alias: string }[] {
    if (hyper == null || (hyper.protocol ?? 'WASM') !== 'WASM') return [];
    return (hyper.attachedDatabases ?? [])
        .filter(database => database.path?.startsWith(CLOUDS_FOLDER) && database.alias)
        .map(database => ({ path: database.path!, alias: database.alias! }));
}
