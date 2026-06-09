import * as core from '../core/index.js';

import {
    reduceNotebookState,
    NotebookState,
    createEmptyScriptData,
    ANALYZE_OUTDATED_SCRIPT,
    CATALOG_DID_UPDATE,
    CREATE_NOTEBOOK_ENTRY,
    CREATE_PAGE,
    DELETE_NOTEBOOK_ENTRY,
    PROMOTE_UNCOMMITTED_SCRIPT,
    REGISTER_QUERY,
    SELECT_ENTRY,
    SELECT_NEXT_ENTRY,
    SELECT_PAGE,
    SELECT_PREV_ENTRY,
    UPDATE_NOTEBOOK_ENTRY,
    UPDATE_PAGE_FOLDER_NAME,
    getSelectedPage,
    getSelectedPageEntries,
    getSortedFileNames,
    getSortedFolderNames,
} from './notebook_state.js';
import { createDatalessConnectorInfo } from '../connection/connector_info.js';
import { StorageWriter, StorageWriteTaskVariant } from "../platform/storage/storage_writer.js";
import { Logger } from '../platform/logger/logger.js';
import { createEmptyMetadata, createPageScript, generateScriptFileName } from './notebook_types.js';

class NullLogger extends Logger {
    public destroy(): void { }
    protected flushPendingRecords(): void { }
}

class NullStorageBackend {
    async listSessions(): Promise<string[]> { return []; }
    async loadSession(): Promise<any> { return {}; }
    async saveSessionManifest(): Promise<void> { }
    async deleteSession(): Promise<void> { }
    async loadSessionSchema(): Promise<string | null> { return null; }
    async saveSessionSchema(): Promise<void> { }
    async loadSessionFunctions(): Promise<string | null> { return null; }
    async saveSessionFunctions(): Promise<void> { }
    async loadNotebookPages(): Promise<any[]> { return []; }
    async createNotebookPage(): Promise<void> { }
    async deleteNotebookPage(): Promise<void> { }
    async reorderNotebookPage(): Promise<void> { }
    async loadNotebookScript(): Promise<any> { return {}; }
    async saveNotebookScript(): Promise<void> { }
    async deleteNotebookScript(): Promise<void> { }
    async reorderNotebookScript(): Promise<void> { }
    async loadNotebookScriptDraft(): Promise<string | null> { return null; }
    async saveNotebookScriptDraft(): Promise<void> { }
}

class NullStorageWriter extends StorageWriter {
    public override async write(_key: string, _task: StorageWriteTaskVariant, _debounce?: number): Promise<boolean> {
        return true;
    }
}

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL | null = null;
const logger = new NullLogger();
const backend = new NullStorageBackend() as any;
const storage = new NullStorageWriter(logger, backend);

beforeAll(async () => {
    const wasmBinary = await DASHQL_PRECOMPILED;
    dql = await core.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});

afterEach(() => {
    dql!.resetUnsafe();
});

const MAIN_FOLDER = 'Main';

// Builds a minimal DEMO-connector NotebookState with a single 'Main' page
// containing one committed script and a separate uncommitted script.
function buildState(): NotebookState {
    const catalog = dql!.createCatalog();
    const registry = dql!.createScriptRegistry();
    const [committedKey, committedData] = createEmptyScriptData(dql!, catalog);
    const [uncommittedKey, uncommittedData] = createEmptyScriptData(dql!, catalog);
    const sessionId = crypto.randomUUID();
    const initialFile = generateScriptFileName({});
    return {
        instance: dql!,
        sessionId,
        notebookMetadata: createEmptyMetadata(),
        connectorInfo: createDatalessConnectorInfo(true),
        connectionCatalog: catalog,
        scriptRegistry: registry,
        scripts: {
            [committedKey]: { ...committedData, folderName: MAIN_FOLDER, fileName: initialFile },
            [uncommittedKey]: uncommittedData,
        },
        notebookPages: {
            [MAIN_FOLDER]: {
                folderName: MAIN_FOLDER,
                scripts: {
                    [initialFile]: createPageScript(committedKey, initialFile),
                },
            },
        },
        uncommittedScriptId: uncommittedKey,
        notebookUserFocus: { folderName: MAIN_FOLDER, fileName: initialFile, interactionCounter: 0 },
        semanticUserFocus: null,
    };
}

function reduce(state: NotebookState, action: Parameters<typeof reduceNotebookState>[1]): NotebookState {
    return reduceNotebookState(state, action, storage, logger, true);
}

function pageEntries(state: NotebookState) {
    return getSelectedPageEntries(state);
}

function pageEntryCount(state: NotebookState) {
    const page = getSelectedPage(state);
    return page ? Object.keys(page.scripts).length : 0;
}

function folderNames(state: NotebookState) {
    return getSortedFolderNames(state.notebookPages);
}

// ---------------------------------------------------------------------------
// SELECT_PAGE
// ---------------------------------------------------------------------------

describe('SELECT_PAGE', () => {
    it('navigates to a valid folder name', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_PAGE, value: null });
        expect(folderNames(s1).length).toBe(2);
        const s2 = reduce(s1, { type: SELECT_PAGE, value: MAIN_FOLDER });
        expect(s2.notebookUserFocus.folderName).toBe(MAIN_FOLDER);
    });

    it('is a no-op for an unknown folder name', () => {
        const state = buildState();
        const next = reduce(state, { type: SELECT_PAGE, value: 'Nonexistent' });
        expect(next).toBe(state);
    });

    it('clears semanticUserFocus', () => {
        const state: NotebookState = {
            ...buildState(),
            semanticUserFocus: { registryColumnInfo: null } as any,
        };
        const next = reduce(state, { type: SELECT_PAGE, value: MAIN_FOLDER });
        expect(next.semanticUserFocus).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// SELECT_NEXT_ENTRY / SELECT_PREV_ENTRY / SELECT_ENTRY
// ---------------------------------------------------------------------------

describe('SELECT_NEXT_ENTRY', () => {
    it('advances to the next entry by sorted file name', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const files = getSortedFileNames(getSelectedPage(s1)!);
        expect(files.length).toBe(2);
        // Move focus back to first entry, then advance.
        const s2 = reduce(
            { ...s1, notebookUserFocus: { ...s1.notebookUserFocus, fileName: files[0] } },
            { type: SELECT_NEXT_ENTRY, value: null },
        );
        expect(s2.notebookUserFocus.fileName).toBe(files[1]);
    });

    it('is capped at the last entry', () => {
        const state = buildState(); // 1 committed entry
        const next = reduce(state, { type: SELECT_NEXT_ENTRY, value: null });
        expect(next.notebookUserFocus.fileName).toBe(state.notebookUserFocus.fileName);
    });
});

describe('SELECT_PREV_ENTRY', () => {
    it('moves to the previous entry by sorted file name', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const files = getSortedFileNames(getSelectedPage(s1)!);
        const s2 = reduce(
            { ...s1, notebookUserFocus: { ...s1.notebookUserFocus, fileName: files[1] } },
            { type: SELECT_PREV_ENTRY, value: null },
        );
        expect(s2.notebookUserFocus.fileName).toBe(files[0]);
    });

    it('clamps at the first entry', () => {
        const state = buildState();
        const next = reduce(state, { type: SELECT_PREV_ENTRY, value: null });
        expect(next.notebookUserFocus.fileName).toBe(state.notebookUserFocus.fileName);
    });
});

describe('SELECT_ENTRY', () => {
    it('selects an entry by file name', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const files = getSortedFileNames(getSelectedPage(s1)!);
        const s2 = reduce(s1, { type: SELECT_ENTRY, value: files[0] });
        expect(s2.notebookUserFocus.fileName).toBe(files[0]);
    });

    it('is a no-op for an unknown file name', () => {
        const state = buildState();
        const next = reduce(state, { type: SELECT_ENTRY, value: 'nope.sql' });
        expect(next).toBe(state);
    });
});

// ---------------------------------------------------------------------------
// CREATE_PAGE
// ---------------------------------------------------------------------------

describe('CREATE_PAGE', () => {
    it('appends a new page without reallocating the notebook draft', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_PAGE, value: null });
        expect(folderNames(next).length).toBe(2);
        expect(next.uncommittedScriptId).toBe(state.uncommittedScriptId);
        expect(next.scripts[next.uncommittedScriptId]).toBeDefined();
    });

    it('moves focus to the new page', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_PAGE, value: null });
        expect(next.notebookUserFocus.folderName).toBe('Untitled');
    });

    it('new page has an auto-created script', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_PAGE, value: null });
        const newPage = next.notebookPages['Untitled'];
        expect(Object.keys(newPage.scripts).length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// CREATE_NOTEBOOK_ENTRY
// ---------------------------------------------------------------------------

describe('CREATE_NOTEBOOK_ENTRY', () => {
    it('appends a new entry to the selected page', () => {
        const state = buildState();
        const prevCount = pageEntryCount(state);
        const next = reduce(state, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        expect(pageEntryCount(next)).toBe(prevCount + 1);
    });

    it('adds the corresponding script to the script map', () => {
        const state = buildState();
        const prevScriptCount = Object.keys(state.scripts).length;
        const next = reduce(state, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        expect(Object.keys(next.scripts).length).toBe(prevScriptCount + 1);
    });

    it('moves focus to the newly created entry', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const files = getSortedFileNames(getSelectedPage(next)!);
        expect(files).toContain(next.notebookUserFocus.fileName);
        // The new entry is the last sorted file
        expect(files[files.length - 1]).toBe(next.notebookUserFocus.fileName);
    });

    it('new entry scriptId is present in the script map', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const page = getSelectedPage(next)!;
        const focusFile = next.notebookUserFocus.fileName;
        const newEntry = page.scripts[focusFile];
        expect(next.scripts[newEntry.scriptId]).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// DELETE_NOTEBOOK_ENTRY
// ---------------------------------------------------------------------------

describe('DELETE_NOTEBOOK_ENTRY', () => {
    it('removes the targeted entry', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const files = getSortedFileNames(getSelectedPage(s1)!);
        const next = reduce(s1, { type: DELETE_NOTEBOOK_ENTRY, value: files[0] });
        expect(pageEntryCount(next)).toBe(1);
        expect(getSelectedPage(next)!.scripts[files[0]]).toBeUndefined();
    });

    it('is a no-op when only one entry remains in the only page', () => {
        const state = buildState(); // 1 committed entry
        const file = state.notebookUserFocus.fileName;
        const next = reduce(state, { type: DELETE_NOTEBOOK_ENTRY, value: file });
        expect(pageEntryCount(next)).toBe(1);
    });

    it('is a no-op for an unknown file name', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const next = reduce(s1, { type: DELETE_NOTEBOOK_ENTRY, value: 'nope.sql' });
        expect(next).toBe(s1);
    });

    it('adjusts focus to the previous sorted entry when deleting the focused one', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const files = getSortedFileNames(getSelectedPage(s1)!);
        // Delete the second (focused) entry
        const s2 = reduce(s1, { type: DELETE_NOTEBOOK_ENTRY, value: files[1] });
        expect(s2.notebookUserFocus.fileName).toBe(files[0]);
    });

    it('removes dead scripts from the script map', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const files = getSortedFileNames(getSelectedPage(s1)!);
        const deletedFile = files[1];
        const deletedScriptId = getSelectedPage(s1)!.scripts[deletedFile].scriptId;
        expect(s1.scripts[deletedScriptId]).toBeDefined();
        const next = reduce(s1, { type: DELETE_NOTEBOOK_ENTRY, value: deletedFile });
        expect(next.scripts[deletedScriptId]).toBeUndefined();
    });

    it('preserves the notebook uncommitted script', () => {
        const state = buildState();
        const stateWithSecondEntry = reduce(state, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const uncommittedScriptId = stateWithSecondEntry.uncommittedScriptId;
        const files = getSortedFileNames(getSelectedPage(stateWithSecondEntry)!);

        const next = reduce(stateWithSecondEntry, { type: DELETE_NOTEBOOK_ENTRY, value: files[1] });

        expect(next.uncommittedScriptId).toBe(uncommittedScriptId);
        expect(next.scripts[uncommittedScriptId]).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// UPDATE_NOTEBOOK_ENTRY
// ---------------------------------------------------------------------------

describe('UPDATE_NOTEBOOK_ENTRY', () => {
    it('renames the targeted entry', () => {
        const state = buildState();
        const oldFile = state.notebookUserFocus.fileName;
        const next = reduce(state, { type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: oldFile, newFileName: '01-query.sql' } });
        expect(getSelectedPage(next)!.scripts['01-query.sql']).toBeDefined();
        expect(getSelectedPage(next)!.scripts[oldFile]).toBeUndefined();
    });

    it('is a no-op for an unknown file name', () => {
        const state = buildState();
        const next = reduce(state, { type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: 'nope.sql', newFileName: 'test.sql' } });
        expect(next).toBe(state);
    });

    it('marks script analysis outdated on rename', () => {
        const state = buildState();
        const file = state.notebookUserFocus.fileName;
        const scriptId = getSelectedPage(state)!.scripts[file].scriptId;
        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s1.scripts[scriptId].scriptAnalysis.outdated).toBe(false);

        const s2 = reduce(s1, { type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: file, newFileName: '02-renamed.sql' } });
        expect(s2.scripts[scriptId].scriptAnalysis.outdated).toBe(true);
    });

    it('does not mark outdated when fileName is unchanged', () => {
        const state = buildState();
        const file = state.notebookUserFocus.fileName;
        const scriptId = getSelectedPage(state)!.scripts[file].scriptId;

        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s1.scripts[scriptId].scriptAnalysis.outdated).toBe(false);

        const s2 = reduce(s1, { type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: file, newFileName: file } });
        expect(s2.scripts[scriptId].scriptAnalysis.outdated).toBe(false);
    });

    it('updates catalog path after re-analysis following rename', () => {
        const state = buildState();
        const oldName = state.notebookUserFocus.fileName;
        const folder = MAIN_FOLDER;
        const scriptId = getSelectedPage(state)!.scripts[oldName].scriptId;
        state.scripts[scriptId].script.insertTextAt(0, 'SELECT 1 as x, 2 as y');

        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s1.scripts[scriptId].annotations.tableDefs).toContain(`${folder}/${oldName}`);

        const newName = '02-renamed.sql';
        const s2 = reduce(s1, { type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: oldName, newFileName: newName } });
        expect(s2.scripts[scriptId].scriptAnalysis.outdated).toBe(true);

        const s3 = reduce(s2, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s3.scripts[scriptId].scriptAnalysis.outdated).toBe(false);
        expect(s3.scripts[scriptId].annotations.tableDefs).toContain(`${folder}/${newName}`);
        expect(s3.scripts[scriptId].annotations.tableDefs).not.toContain(`${folder}/${oldName}`);
    });
});

describe('UPDATE_PAGE_FOLDER_NAME', () => {
    it('renames the targeted page', () => {
        const state = buildState();
        const next = reduce(state, { type: UPDATE_PAGE_FOLDER_NAME, value: { folderName: MAIN_FOLDER, newFolderName: 'Analytics' } });
        expect(next.notebookPages['Analytics']).toBeDefined();
        expect(next.notebookPages[MAIN_FOLDER]).toBeUndefined();
    });

    it('is a no-op for an unknown folder name', () => {
        const state = buildState();
        const next = reduce(state, { type: UPDATE_PAGE_FOLDER_NAME, value: { folderName: 'Nope', newFolderName: 'Test' } });
        expect(next).toBe(state);
    });

    it('marks all page scripts outdated on folder rename', () => {
        const state = buildState();
        const file = state.notebookUserFocus.fileName;
        const scriptId = getSelectedPage(state)!.scripts[file].scriptId;

        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s1.scripts[scriptId].scriptAnalysis.outdated).toBe(false);

        const s2 = reduce(s1, { type: UPDATE_PAGE_FOLDER_NAME, value: { folderName: MAIN_FOLDER, newFolderName: 'Analytics' } });
        expect(s2.scripts[scriptId].scriptAnalysis.outdated).toBe(true);
    });

    it('does not mark outdated when folderName is unchanged', () => {
        const state = buildState();
        const file = state.notebookUserFocus.fileName;
        const scriptId = getSelectedPage(state)!.scripts[file].scriptId;

        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s1.scripts[scriptId].scriptAnalysis.outdated).toBe(false);

        const s2 = reduce(s1, { type: UPDATE_PAGE_FOLDER_NAME, value: { folderName: MAIN_FOLDER, newFolderName: MAIN_FOLDER } });
        expect(s2.scripts[scriptId].scriptAnalysis.outdated).toBe(false);
    });

    it('updates catalog path after re-analysis following folder rename', () => {
        const state = buildState();
        const file = state.notebookUserFocus.fileName;
        const oldFolder = MAIN_FOLDER;
        const scriptId = getSelectedPage(state)!.scripts[file].scriptId;
        state.scripts[scriptId].script.insertTextAt(0, 'SELECT 1 as x');

        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s1.scripts[scriptId].annotations.tableDefs).toContain(`${oldFolder}/${file}`);

        const newFolder = 'Analytics';
        const s2 = reduce(s1, { type: UPDATE_PAGE_FOLDER_NAME, value: { folderName: oldFolder, newFolderName: newFolder } });
        expect(s2.scripts[scriptId].scriptAnalysis.outdated).toBe(true);

        const s3 = reduce(s2, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s3.scripts[scriptId].annotations.tableDefs).toContain(`${newFolder}/${file}`);
        expect(s3.scripts[scriptId].annotations.tableDefs).not.toContain(`${oldFolder}/${file}`);
    });
});

// ---------------------------------------------------------------------------
// PROMOTE_UNCOMMITTED_SCRIPT
// ---------------------------------------------------------------------------

describe('PROMOTE_UNCOMMITTED_SCRIPT', () => {
    it('appends the uncommitted script as a new committed entry', () => {
        const state = buildState();
        const prevUncommittedId = state.uncommittedScriptId;
        const prevEntryCount = pageEntryCount(state);
        const next = reduce(state, { type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
        expect(pageEntryCount(next)).toBe(prevEntryCount + 1);
        const focusFile = next.notebookUserFocus.fileName;
        const promotedEntry = getSelectedPage(next)!.scripts[focusFile];
        expect(promotedEntry.scriptId).toBe(prevUncommittedId);
    });

    it('allocates a new uncommitted script after promotion', () => {
        const state = buildState();
        const prevUncommittedId = state.uncommittedScriptId;
        const next = reduce(state, { type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
        const newUncommittedId = next.uncommittedScriptId;
        expect(newUncommittedId).not.toBe(prevUncommittedId);
        expect(next.scripts[newUncommittedId]).toBeDefined();
    });

    it('moves focus to the promoted entry', () => {
        const state = buildState();
        const next = reduce(state, { type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
        const files = getSortedFileNames(getSelectedPage(next)!);
        expect(next.notebookUserFocus.fileName).toBe(files[files.length - 1]);
    });
});

// ---------------------------------------------------------------------------
// CATALOG_DID_UPDATE
// ---------------------------------------------------------------------------

describe('CATALOG_DID_UPDATE', () => {
    it('marks every script outdated', () => {
        const state = buildState();
        const firstKey = +Object.keys(state.scripts)[0];
        state.scripts[firstKey] = {
            ...state.scripts[firstKey],
            scriptAnalysis: {
                ...state.scripts[firstKey].scriptAnalysis,
                outdated: true
            }
        };
        const next = reduce(state, { type: CATALOG_DID_UPDATE, value: null });
        for (const scriptData of Object.values(next.scripts)) {
            expect(scriptData.scriptAnalysis.outdated).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// ANALYZE_OUTDATED_SCRIPT
// ---------------------------------------------------------------------------

describe('ANALYZE_OUTDATED_SCRIPT', () => {
    it('sets outdated=false on the targeted script', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        expect(state.scripts[scriptKey].scriptAnalysis.outdated).toBe(true);
        const next = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptKey });
        expect(next.scripts[scriptKey].scriptAnalysis.outdated).toBe(false);
    });

    it('is a no-op when the script is already up to date', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptKey });
        expect(s1.scripts[scriptKey].scriptAnalysis.outdated).toBe(false);
        const s2 = reduce(s1, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptKey });
        expect(s2).toBe(s1);
    });

    it('populates processed buffers after analysis', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const next = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptKey });
        expect(next.scripts[scriptKey].scriptAnalysis).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// REGISTER_QUERY
// ---------------------------------------------------------------------------

describe('REGISTER_QUERY', () => {
    it('records latestQueryId on the referenced script', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const next = reduce(state, { type: REGISTER_QUERY, value: [scriptKey, 42] });
        expect(next.scripts[scriptKey].latestQueryId).toBe(42);
    });

    it('returns the unchanged state for an unknown scriptKey', () => {
        const state = buildState();
        const next = reduce(state, { type: REGISTER_QUERY, value: [99999, 1] });
        expect(next).toBe(state);
    });
});

// Reference to keep imports used if other helpers are not consumed
void pageEntries;
