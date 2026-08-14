/// Is a running natively?
export function isNativePlatform(): boolean {
    return '__TAURI_INTERNALS__' in (globalThis as any);
}
