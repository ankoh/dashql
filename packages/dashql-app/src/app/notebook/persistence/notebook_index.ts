import type { NotebookIndexData, ScriptFolderData } from './storage_backend.js';

const NATURAL_SORT = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function createNotebookIndex(folders: readonly ScriptFolderData[]): NotebookIndexData {
    return {
        folders: folders
            .map(folder => ({
                name: folder.name,
                scripts: folder.scripts
                    .map(script => ({ name: script.name }))
                    .sort((a, b) => NATURAL_SORT.compare(a.name, b.name)),
            }))
            .sort((a, b) => NATURAL_SORT.compare(a.name, b.name)),
    };
}

export function serializeNotebookIndex(folders: readonly ScriptFolderData[]): string {
    return JSON.stringify(createNotebookIndex(folders), null, 2);
}
