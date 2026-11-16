/// Strings by key, like the storage of a tab (sessionStorage) in a browser. Its methods may throw, like a storage that
/// the browser refuses.
export interface KeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
