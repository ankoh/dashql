import type { ClientFunctionSpec } from './clfn_spec.js';

/// The client function specs of extensions/ by the path of their spec.json, JSON that Bazel generates from their
/// sources, each one loaded when a connection needs it
export type ClientFunctionSpecSources = Record<string, () => Promise<ClientFunctionSpec>>;

let SOURCES: ClientFunctionSpecSources = {};

/// The platform says where the specs are: the app passes the chunks that its bundler made, Node reads the files
export function provideClientFunctionSpecs(sources: ClientFunctionSpecSources): void {
    SOURCES = sources;
}

/// Load the client function spec of an extension by its folder in extensions/, such as `d360-api`
export async function loadClientFunctionSpec(folder: string): Promise<ClientFunctionSpec> {
    const suffix = `/${folder}/clfn/spec/spec.json`;
    const load = Object.entries(SOURCES).find(([path]) => path.endsWith(suffix))?.[1];
    if (load === undefined) {
        throw new Error(`no extension in the folder ${folder}`);
    }
    return load();
}
