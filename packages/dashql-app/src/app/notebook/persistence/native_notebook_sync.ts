import type { UnwatchFn, WatchEvent } from '@tauri-apps/plugin-fs';
import type { Logger } from '../../../shared/platform/logger/logger.js';
import type { NotebookLocation } from './notebook_locator.js';
import {
    StorageBackendType,
    STORAGE_SCRIPTS_FOLDER,
    STORAGE_SCRIPT_FUNCTIONS,
    STORAGE_SCRIPT_SCHEMA,
} from './storage_backend.js';

const LOG_CTX = 'native_notebook_sync';
const WATCH_DEBOUNCE_MS = 200;

export interface NativeNotebookWatch {
    notebookId: string;
    dir: string;
}

export type NativeNotebookChanged = (notebookId: string) => void;

export function nativeNotebookWatchForLocation(notebookId: string, location: NotebookLocation): NativeNotebookWatch | null {
    if (location.type !== StorageBackendType.Native || !location.nativePath) {
        return null;
    }
    return { notebookId, dir: location.nativePath };
}

/// True when a watcher event can affect reloadable notebook scripts. The notebook manifest and generated
/// cache are intentionally outside this boundary; connection identity/config changes require a full
/// connection lifecycle rather than an in-place file reload.
export function isNotebookContentWatchEvent(event: WatchEvent, dir: string): boolean {
    if (typeof event.type === 'object' && 'access' in event.type) {
        return false;
    }
    const normalizedDir = dir.replace(/\\/g, '/').replace(/\/$/, '');
    return event.paths.some(rawPath => {
        const path = rawPath.replace(/\\/g, '/');
        const relative = path === normalizedDir ? '' : path.slice(normalizedDir.length + 1);
        return relative === STORAGE_SCRIPT_SCHEMA
            || relative === STORAGE_SCRIPT_FUNCTIONS
            || relative === STORAGE_SCRIPTS_FOLDER
            || relative.startsWith(`${STORAGE_SCRIPTS_FOLDER}/`);
    });
}

/// Owns all native filesystem watcher lifecycle. The rest of the application sees only a notebook-id
/// invalidation, keeping platform events and path normalization out of app state code.
export class NativeNotebookSyncService {
    private readonly logger: Logger;
    private readonly onChanged: NativeNotebookChanged;
    private watches = new Map<string, { dir: string; unwatch: UnwatchFn }>();
    private generation = 0;

    constructor(logger: Logger, onChanged: NativeNotebookChanged) {
        this.logger = logger;
        this.onChanged = onChanged;
    }

    public async reconcile(notebooks: NativeNotebookWatch[]): Promise<void> {
        const generation = ++this.generation;
        const desired = new Map(notebooks.map(notebook => [notebook.notebookId, notebook.dir]));

        for (const [notebookId, current] of this.watches) {
            if (desired.get(notebookId) === current.dir) {
                continue;
            }
            current.unwatch();
            this.watches.delete(notebookId);
        }

        const { watch } = await import('@tauri-apps/plugin-fs');
        for (const [notebookId, dir] of desired) {
            if (generation !== this.generation || this.watches.has(notebookId)) {
                continue;
            }
            try {
                const unwatch = await watch(dir, event => {
                    if (isNotebookContentWatchEvent(event, dir)) {
                        this.onChanged(notebookId);
                    }
                }, { recursive: true, delayMs: WATCH_DEBOUNCE_MS });
                if (generation !== this.generation || desired.get(notebookId) !== dir) {
                    unwatch();
                    continue;
                }
                this.watches.set(notebookId, { dir, unwatch });
            } catch (error) {
                this.logger.warn('failed to watch native notebook', {
                    notebookId,
                    dir,
                    error: String(error),
                }, LOG_CTX);
            }
        }
    }

    public close(): void {
        this.generation++;
        for (const watch of this.watches.values()) {
            watch.unwatch();
        }
        this.watches.clear();
    }
}
