import type { OverlaySpec } from './overlay_spec.js';

/// The specs of overlay/, as JSON that Bazel generates from their sources. Each one is a chunk of its own, so that a
/// connection only loads it when it needs it.
const SPECS = import.meta.glob<OverlaySpec>('@dashql/overlays/*/api/spec.json', { import: 'default' });

/// Load the spec of an overlay by its folder in overlay/, such as `d360`
export async function loadOverlaySpec(folder: string): Promise<OverlaySpec> {
    const suffix = `/${folder}/api/spec.json`;
    const load = Object.entries(SPECS).find(([path]) => path.endsWith(suffix))?.[1];
    if (load === undefined) {
        throw new Error(`no overlay in the folder ${folder}`);
    }
    return load();
}
