export interface HyperDBWebCapabilities {
    readonly crossOriginIsolated: boolean;
    readonly hasSharedArrayBuffer: boolean;
}

function readWebCapabilities(): HyperDBWebCapabilities {
    return {
        crossOriginIsolated: globalThis.crossOriginIsolated === true,
        hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    };
}

export function getHyperDBWebSupportError(
    capabilities: HyperDBWebCapabilities = readWebCapabilities(),
): string | null {
    if (!capabilities.hasSharedArrayBuffer || !capabilities.crossOriginIsolated) {
        return 'HyperDB requires SharedArrayBuffer and a cross-origin-isolated page.';
    }
    return null;
}
