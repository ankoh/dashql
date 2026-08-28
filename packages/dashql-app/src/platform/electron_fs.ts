function bridge(): DashQLElectronBridge['fs'] {
    if (globalThis.dashqlElectron === undefined) throw new Error('Electron filesystem bridge is unavailable');
    return globalThis.dashqlElectron.fs;
}

export const exists = (path: string) => bridge().exists(path);
export const mkdir = (path: string, options?: {recursive?: boolean}) => bridge().mkdir(path, options);
export const readDir = (path: string) => bridge().readDir(path);
export const readFile = (path: string) => bridge().readFile(path);
export const readTextFile = (path: string) => bridge().readTextFile(path);
export const remove = (path: string, options?: {recursive?: boolean}) => bridge().remove(path, options);
export const rename = (from: string, to: string) => bridge().rename(from, to);
export const writeFile = (path: string, data: Uint8Array) => bridge().writeFile(path, data);
export const writeTextFile = (path: string, data: string) => bridge().writeTextFile(path, data);
export const join = async (...parts: string[]) => parts.reduce((result, part) => `${result.replace(/[\\/]$/, '')}/${part.replace(/^[\\/]/, '')}`);
export async function stat(path: string) {
    const value = await bridge().stat(path);
    return {...value, mtime: value.mtime === null ? null : new Date(value.mtime)};
}
