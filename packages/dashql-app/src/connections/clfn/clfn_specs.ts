import type { ClientFunctionSpec } from './clfn_spec.js';

/// The client function specs of extensions/, as JSON that Bazel generates from their sources. Each one is a chunk of its own, so that a
/// connection only loads it when it needs it.
const SPECS = import.meta.glob<ClientFunctionSpec>('@dashql/extensions/*/clfn/spec/spec.json', { import: 'default' });

/// Load the client function spec of an extension by its folder in extensions/, such as `d360`
export async function loadClientFunctionSpec(folder: string): Promise<ClientFunctionSpec> {
    const suffix = `/${folder}/clfn/spec/spec.json`;
    const load = Object.entries(SPECS).find(([path]) => path.endsWith(suffix))?.[1];
    if (load === undefined) {
        throw new Error(`no extension in the folder ${folder}`);
    }
    return load();
}
