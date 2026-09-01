import type { NotebookIndexData, ScriptData } from './storage_backend.js';

const NATURAL_SORT = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function createNotebookIndex(scripts: readonly ScriptData[]): NotebookIndexData {
    return {
        scripts: scripts
            .map(script => ({ name: script.name }))
            .sort((a, b) => NATURAL_SORT.compare(a.name, b.name)),
    };
}

export function serializeNotebookIndex(scripts: readonly ScriptData[]): string {
    return JSON.stringify(createNotebookIndex(scripts), null, 2);
}
