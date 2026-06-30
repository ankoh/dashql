import * as core from '../core/index.js';

import {
    reduceNotebookState,
    NotebookState,
    createEmptyScriptData,
    ANALYZE_OUTDATED_SCRIPT,
    CATALOG_DID_UPDATE,
    CREATE_NOTEBOOK_ENTRY,
    CREATE_NOTEBOOK_ENTRY_WITH_TEXT,
    CREATE_PAGE,
    DELETE_NOTEBOOK_ENTRY,
    PROMOTE_UNCOMMITTED_SCRIPT,
    REGISTER_QUERY,
    SELECT_ENTRY,
    SET_SCRIPT_TEXT,
    destroyState,
    getExecutableQueryText,
    getScriptKeysInFeedOrder,
    analyzeAllScriptsInNotebook,
    SELECT_NEXT_ENTRY,
    SELECT_PAGE,
    SELECT_PREV_ENTRY,
    UPDATE_NOTEBOOK_ENTRY,
    UPDATE_PAGE_FOLDER_NAME,
    REORDER_PAGES,
    REORDER_NOTEBOOK_SCRIPTS,
    getSelectedPage,
    getSelectedPageEntries,
    getSortedFileNames,
    getSortedFolderNames,
} from './notebook_state.js';
import { createDatalessConnectorInfo } from '../connection/connector_info.js';
import { StorageWriter, StorageWriteTaskVariant, WRITE_NOTEBOOK_SCRIPT, DELETE_NOTEBOOK_SCRIPT, RENAME_NOTEBOOK_PAGE, RENAME_NOTEBOOK_SCRIPT, CREATE_NOTEBOOK_PAGE, DELETE_NOTEBOOK_PAGE } from "../platform/storage/storage_writer.js";
import { Logger } from '../platform/logger/logger.js';
import { createEmptyMetadata, createPageScript, generateScriptFileName, normalizePageName, pageOrderPrefixString, formatPageOrderPrefix, normalizeScriptName, scriptOrderPrefixString, formatScriptOrderPrefix, scriptDisplayName, uniqueScriptBase, planScriptInsertion, NotebookPageScript } from './notebook_types.js';

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
    async renameNotebookPage(): Promise<void> { }
    async reorderNotebookPage(): Promise<void> { }
    async loadNotebookScript(): Promise<any> { return {}; }
    async saveNotebookScript(): Promise<void> { }
    async deleteNotebookScript(): Promise<void> { }
    async renameNotebookScript(): Promise<void> { }
    async loadNotebookScriptDraft(): Promise<string | null> { return null; }
    async saveNotebookScriptDraft(): Promise<void> { }
}

class NullStorageWriter extends StorageWriter {
    public override async write(_key: string, _task: StorageWriteTaskVariant, _debounce?: number): Promise<boolean> {
        return true;
    }
}

/// Captures every (key, task) the reducer schedules so tests can assert on the persistence plan
/// (e.g. that a script's write is never shadowed by a delete on the same on-disk path).
class RecordingStorageWriter extends StorageWriter {
    public records: { key: string; task: StorageWriteTaskVariant }[] = [];
    public override async write(key: string, task: StorageWriteTaskVariant, _debounce?: number): Promise<boolean> {
        this.records.push({ key, task });
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
        // Creating a page re-prefixes the original page (e.g. "Main" -> "1_Main"); navigate to it
        // under its current (prefixed) name.
        const mainFolder = folderNames(s1)[0];
        const s2 = reduce(s1, { type: SELECT_PAGE, value: mainFolder });
        expect(s2.notebookUserFocus.folderName).toBe(mainFolder);
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

    it('moves focus to the new (prefixed) page', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_PAGE, value: null });
        expect(normalizePageName(next.notebookUserFocus.folderName)).toBe('Untitled');
    });

    it('new page has an auto-created script', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_PAGE, value: null });
        const newPage = next.notebookPages[next.notebookUserFocus.folderName];
        expect(Object.keys(newPage.scripts).length).toBe(1);
    });

    it('prefixes the new page and appends it fully to the right', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_PAGE, value: null });
        const sorted = getSortedFolderNames(next.notebookPages);
        // Both pages now carry a dense numeric prefix; the new "Untitled" sorts last.
        expect(sorted).toEqual(['1_Main', '2_Untitled']);
        expect(normalizePageName(sorted[sorted.length - 1])).toBe('Untitled');
    });

    it('normalises still-unprefixed sibling pages on create', () => {
        // A notebook that mixes prefixed and prefix-free pages (as a freshly migrated example does).
        const state = buildMultiPageState(['1_main', '2_explain', 'vis_data', 'vis_spec']);
        const next = reduce(state, { type: CREATE_PAGE, value: null });
        const sorted = getSortedFolderNames(next.notebookPages);
        // Every page ends up prefixed, original order preserved, new page last.
        expect(sorted.map(normalizePageName)).toEqual(['main', 'explain', 'vis_data', 'vis_spec', 'Untitled']);
        expect(sorted).toEqual(['1_main', '2_explain', '3_vis_data', '4_vis_spec', '5_Untitled']);
    });

    it('keeps adding new pages to the right across repeated creates', () => {
        let s = buildState();
        s = reduce(s, { type: CREATE_PAGE, value: null });
        s = reduce(s, { type: CREATE_PAGE, value: null });
        const sorted = getSortedFolderNames(s.notebookPages);
        expect(sorted.map(normalizePageName)).toEqual(['Main', 'Untitled', 'Untitled 2']);
        expect(sorted).toEqual(['1_Main', '2_Untitled', '3_Untitled 2']);
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
    it('renames the targeted entry, editing only the clean name and preserving the ordering prefix', () => {
        const state = buildState();
        const oldFile = state.notebookUserFocus.fileName; // "1_script.sql"
        // The rename input edits the clean display name; the reducer keeps the prefix and ".sql".
        const next = reduce(state, { type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: oldFile, newFileName: 'query' } });
        const files = getSortedFileNames(getSelectedPage(next)!);
        expect(files.map(scriptDisplayName)).toEqual(['query']);
        expect(getSelectedPage(next)!.scripts[oldFile]).toBeUndefined();
        // The ordering prefix is preserved across the rename.
        expect(scriptOrderPrefixString(files[0])).toBe(scriptOrderPrefixString(oldFile));
    });

    it('normalises a typed-in prefix/suffix down to the clean name', () => {
        const state = buildState();
        const oldFile = state.notebookUserFocus.fileName; // "1_script.sql"
        // Whatever prefix/extension the user types is stripped to the bare clean base.
        const next = reduce(state, { type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: oldFile, newFileName: '07-query.sql' } });
        const files = getSortedFileNames(getSelectedPage(next)!);
        expect(files.map(scriptDisplayName)).toEqual(['query']);
        // The script keeps ITS prefix, not the "07" the user typed.
        expect(scriptOrderPrefixString(files[0])).toBe(scriptOrderPrefixString(oldFile));
    });

    it('disambiguates a clean name that collides with another script', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const files = getSortedFileNames(getSelectedPage(s1)!);
        // Rename the first script to "shared", then rename the second to "shared" too.
        const s2 = reduce(s1, { type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: files[0], newFileName: 'shared' } });
        const files2 = getSortedFileNames(getSelectedPage(s2)!);
        const s3 = reduce(s2, { type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: files2[1], newFileName: 'shared' } });
        const display = getSortedFileNames(getSelectedPage(s3)!).map(scriptDisplayName);
        expect(display).toContain('shared');
        expect(display).toContain('shared-2');
        // The two scripts keep distinct clean names (the SQL reference namespace stays unique).
        expect(new Set(display).size).toBe(display.length);
    });

    it('ignores an empty (whitespace-only) clean name', () => {
        const state = buildState();
        const oldFile = state.notebookUserFocus.fileName;
        const next = reduce(state, { type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: oldFile, newFileName: '   ' } });
        expect(next).toBe(state);
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

    it('updates catalog path after re-analysis following rename, using clean names', () => {
        const state = buildState();
        const oldName = state.notebookUserFocus.fileName;
        const folder = MAIN_FOLDER;
        const scriptId = getSelectedPage(state)!.scripts[oldName].scriptId;
        state.scripts[scriptId].script.insertTextAt(0, 'SELECT 1 as x, 2 as y');

        // The catalog path is the clean folder/file: no ordering prefix, no ".sql".
        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s1.scripts[scriptId].annotations.tableDefs).toContain(`${folder}/${scriptDisplayName(oldName)}`);

        const s2 = reduce(s1, { type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: oldName, newFileName: 'renamed' } });
        expect(s2.scripts[scriptId].scriptAnalysis.outdated).toBe(true);
        const newName = getSortedFileNames(getSelectedPage(s2)!)[0];

        const s3 = reduce(s2, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s3.scripts[scriptId].scriptAnalysis.outdated).toBe(false);
        expect(s3.scripts[scriptId].annotations.tableDefs).toContain(`${folder}/renamed`);
        expect(scriptDisplayName(newName)).toBe('renamed');
        expect(s3.scripts[scriptId].annotations.tableDefs).not.toContain(`${folder}/${scriptDisplayName(oldName)}`);
    });
});

describe('UPDATE_PAGE_FOLDER_NAME', () => {
    it('renames the targeted page, assigning it an ordering prefix', () => {
        const state = buildState();
        const next = reduce(state, { type: UPDATE_PAGE_FOLDER_NAME, value: { folderName: MAIN_FOLDER, newFolderName: 'Analytics' } });
        // The renamed page gains a numeric prefix (single page in a single-page notebook -> "1_").
        expect(next.notebookPages['1_Analytics']).toBeDefined();
        expect(next.notebookPages[MAIN_FOLDER]).toBeUndefined();
        expect(normalizePageName(next.notebookUserFocus.folderName)).toBe('Analytics');
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

    it('updates catalog path after re-analysis following folder rename, using clean names', () => {
        const state = buildState();
        const file = state.notebookUserFocus.fileName;
        const cleanFile = scriptDisplayName(file);
        const oldFolder = MAIN_FOLDER;
        const scriptId = getSelectedPage(state)!.scripts[file].scriptId;
        state.scripts[scriptId].script.insertTextAt(0, 'SELECT 1 as x');

        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s1.scripts[scriptId].annotations.tableDefs).toContain(`${oldFolder}/${cleanFile}`);

        const newFolder = 'Analytics';
        const s2 = reduce(s1, { type: UPDATE_PAGE_FOLDER_NAME, value: { folderName: oldFolder, newFolderName: newFolder } });
        expect(s2.scripts[scriptId].scriptAnalysis.outdated).toBe(true);

        const s3 = reduce(s2, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s3.scripts[scriptId].annotations.tableDefs).toContain(`${newFolder}/${cleanFile}`);
        expect(s3.scripts[scriptId].annotations.tableDefs).not.toContain(`${oldFolder}/${cleanFile}`);
    });
});

// ---------------------------------------------------------------------------
// Page ordering prefix helpers
// ---------------------------------------------------------------------------

describe('page order prefix helpers', () => {
    it('normalizePageName removes a leading <digits>_ prefix', () => {
        expect(normalizePageName('03_main')).toBe('main');
        expect(normalizePageName('1_vis_data')).toBe('vis_data');
        expect(normalizePageName('main')).toBe('main');
        expect(normalizePageName('Untitled 2')).toBe('Untitled 2');
    });

    it('pageOrderPrefixString returns the prefix including the underscore, else empty', () => {
        expect(pageOrderPrefixString('03_main')).toBe('03_');
        expect(pageOrderPrefixString('main')).toBe('');
    });

    it('formatPageOrderPrefix pads only to the digits the total requires', () => {
        expect(formatPageOrderPrefix(1, 9)).toBe('1_');
        expect(formatPageOrderPrefix(1, 10)).toBe('01_');
        expect(formatPageOrderPrefix(12, 12)).toBe('12_');
        expect(formatPageOrderPrefix(7, 100)).toBe('007_');
    });
});

// ---------------------------------------------------------------------------
// REORDER_PAGES
// ---------------------------------------------------------------------------

// Builds a state with several named pages, each holding one script seeded with SQL.
function buildMultiPageState(folderNames: string[]): NotebookState {
    const state = buildState();
    // Drop the default 'Main' page; rebuild pages from the requested names.
    const pages: NotebookState['notebookPages'] = {};
    const scripts: NotebookState['scripts'] = {
        [state.uncommittedScriptId]: state.scripts[state.uncommittedScriptId],
    };
    let firstFolder = '';
    let firstFile = '';
    for (const folderName of folderNames) {
        const [key, data] = createEmptyScriptData(state.instance, state.connectionCatalog);
        const fileName = generateScriptFileName({});
        data.script.insertTextAt(0, 'SELECT 1 as x');
        scripts[key] = { ...data, folderName, fileName };
        pages[folderName] = { folderName, scripts: { [fileName]: createPageScript(key, fileName) } };
        if (firstFolder === '') { firstFolder = folderName; firstFile = fileName; }
    }
    return {
        ...state,
        scripts,
        notebookPages: pages,
        notebookUserFocus: { folderName: firstFolder, fileName: firstFile, interactionCounter: 0 },
    };
}

describe('REORDER_PAGES', () => {
    it('assigns dense ordering prefixes that sort to the requested order', () => {
        const state = buildMultiPageState(['alpha', 'beta', 'gamma']);
        // Default lexicographic order is alpha, beta, gamma. Request gamma, alpha, beta.
        const next = reduce(state, { type: REORDER_PAGES, value: ['gamma', 'alpha', 'beta'] });
        const sorted = getSortedFolderNames(next.notebookPages);
        expect(sorted.map(normalizePageName)).toEqual(['gamma', 'alpha', 'beta']);
        // Prefixes are dense and single-digit for a 3-page notebook.
        expect(sorted).toEqual(['1_gamma', '2_alpha', '3_beta']);
    });

    it('keeps the clean (SQL-visible) reference namespace stable across a reorder', () => {
        const state = buildMultiPageState(['alpha', 'beta']);
        const betaFile = Object.keys(state.notebookPages['beta'].scripts)[0];
        const cleanFile = scriptDisplayName(betaFile);
        const betaScriptId = state.notebookPages['beta'].scripts[betaFile].scriptId;

        // Analyze beta so its catalog path (tableDefs) is populated with the clean name.
        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: betaScriptId });
        expect(s1.scripts[betaScriptId].annotations.tableDefs).toContain(`beta/${cleanFile}`);

        // Reorder beta to the front, then re-analyze: the catalog path must still be the clean name.
        const s2 = reduce(s1, { type: REORDER_PAGES, value: ['beta', 'alpha'] });
        const movedFolder = getSortedFolderNames(s2.notebookPages)[0];
        expect(normalizePageName(movedFolder)).toBe('beta');
        const s3 = reduce(s2, { type: ANALYZE_OUTDATED_SCRIPT, value: betaScriptId });
        expect(s3.scripts[betaScriptId].annotations.tableDefs).toContain(`beta/${cleanFile}`);
        expect(s3.scripts[betaScriptId].annotations.tableDefs).not.toContain(`${movedFolder}/${cleanFile}`);
    });

    it('is a no-op when the requested order matches the current order', () => {
        const state = buildMultiPageState(['alpha', 'beta', 'gamma']);
        const next = reduce(state, { type: REORDER_PAGES, value: ['alpha', 'beta', 'gamma'] });
        expect(next).toBe(state);
    });

    it('appends omitted pages after the requested ones without dropping any', () => {
        const state = buildMultiPageState(['alpha', 'beta', 'gamma']);
        const next = reduce(state, { type: REORDER_PAGES, value: ['gamma'] });
        const sorted = getSortedFolderNames(next.notebookPages);
        expect(sorted.map(normalizePageName)).toEqual(['gamma', 'alpha', 'beta']);
    });

    it('moves focus to the renamed folder of the previously focused page', () => {
        const state = buildMultiPageState(['alpha', 'beta', 'gamma']);
        const s1 = reduce(state, { type: SELECT_PAGE, value: 'beta' });
        expect(s1.notebookUserFocus.folderName).toBe('beta');
        const s2 = reduce(s1, { type: REORDER_PAGES, value: ['gamma', 'beta', 'alpha'] });
        expect(normalizePageName(s2.notebookUserFocus.folderName)).toBe('beta');
        expect(s2.notebookPages[s2.notebookUserFocus.folderName]).toBeDefined();
    });

    it('re-densifies prefixes on a notebook that already has them', () => {
        const state = buildMultiPageState(['1_alpha', '2_beta', '3_gamma']);
        const next = reduce(state, { type: REORDER_PAGES, value: ['3_gamma', '1_alpha', '2_beta'] });
        expect(getSortedFolderNames(next.notebookPages)).toEqual(['1_gamma', '2_alpha', '3_beta']);
    });
});

describe('UPDATE_PAGE_FOLDER_NAME keeps the page in its slot', () => {
    it('retains the page position (re-deriving the prefix) on rename', () => {
        const state = buildMultiPageState(['1_alpha', '2_beta']);
        const next = reduce(state, { type: UPDATE_PAGE_FOLDER_NAME, value: { folderName: '2_beta', newFolderName: 'reports' } });
        expect(next.notebookPages['2_reports']).toBeDefined();
        expect(next.notebookPages['2_beta']).toBeUndefined();
        // Order is unchanged: alpha still before the renamed page.
        expect(getSortedFolderNames(next.notebookPages).map(normalizePageName)).toEqual(['alpha', 'reports']);
    });

    it('assigns a prefix when renaming a page that had none, keeping its slot', () => {
        // Mixed notebook: a prefix-free page sitting after a prefixed one.
        const state = buildMultiPageState(['1_alpha', 'zebra']);
        const next = reduce(state, { type: UPDATE_PAGE_FOLDER_NAME, value: { folderName: 'zebra', newFolderName: 'reports' } });
        // 'zebra' is in slot 2 of the view order, so it becomes '2_reports'.
        expect(next.notebookPages['2_reports']).toBeDefined();
        expect(next.notebookPages['zebra']).toBeUndefined();
        expect(getSortedFolderNames(next.notebookPages)).toEqual(['1_alpha', '2_reports']);
    });

    it('normalises still-unprefixed sibling pages on rename', () => {
        const state = buildMultiPageState(['1_main', '2_explain', 'vis_data', 'vis_spec']);
        // Rename the first page; the trailing prefix-free pages must be normalised too.
        const next = reduce(state, { type: UPDATE_PAGE_FOLDER_NAME, value: { folderName: '1_main', newFolderName: 'overview' } });
        expect(getSortedFolderNames(next.notebookPages)).toEqual(['1_overview', '2_explain', '3_vis_data', '4_vis_spec']);
    });

    it('is a no-op when the clean name is unchanged', () => {
        const state = buildMultiPageState(['1_alpha', '2_beta']);
        const next = reduce(state, { type: UPDATE_PAGE_FOLDER_NAME, value: { folderName: '2_beta', newFolderName: 'beta' } });
        expect(next).toBe(state);
    });
});

// ---------------------------------------------------------------------------
// Rename persistence plan: structural renames move files in place rather than
// delete-old + recreate-new. Asserted via the RecordingStorageWriter.
// ---------------------------------------------------------------------------

describe('rename persistence plan', () => {
    function record(state: NotebookState, action: Parameters<typeof reduceNotebookState>[1]) {
        const recorder = new RecordingStorageWriter(logger, backend);
        const next = reduceNotebookState(state, action, recorder, logger, true);
        return { next, records: recorder.records };
    }

    it('UPDATE_PAGE_FOLDER_NAME renames the folder in place (no delete/recreate of the page)', () => {
        const state = buildMultiPageState(['1_alpha', '2_beta']);
        const { records } = record(state, { type: UPDATE_PAGE_FOLDER_NAME, value: { folderName: '2_beta', newFolderName: 'reports' } });

        const renames = records.filter(r => r.task.type === RENAME_NOTEBOOK_PAGE).map(r => r.task.value);
        expect(renames).toEqual([[state.sessionId, '2_beta', '2_reports']]);
        // The renamed page is moved, not torn down and rebuilt.
        expect(records.some(r => r.task.type === DELETE_NOTEBOOK_PAGE)).toBe(false);
        expect(records.some(r => r.task.type === CREATE_NOTEBOOK_PAGE)).toBe(false);
    });

    it('REORDER_PAGES renames each moved folder in place', () => {
        const state = buildMultiPageState(['1_alpha', '2_beta', '3_gamma']);
        const { records } = record(state, { type: REORDER_PAGES, value: ['3_gamma', '1_alpha', '2_beta'] });

        const renames = records.filter(r => r.task.type === RENAME_NOTEBOOK_PAGE).map(r => r.task.value);
        // gamma->slot1, alpha->slot2, beta->slot3. The clean names are held stable.
        expect(renames).toEqual([
            [state.sessionId, '3_gamma', '1_gamma'],
            [state.sessionId, '1_alpha', '2_alpha'],
            [state.sessionId, '2_beta', '3_beta'],
        ]);
        expect(records.some(r => r.task.type === DELETE_NOTEBOOK_PAGE)).toBe(false);
    });

    it('CREATE_PAGE creates the new page but only renames the pre-existing siblings it reprefixes', () => {
        // Two prefix-free siblings force a reprefix; the brand-new page has nothing on disk yet.
        const state = buildMultiPageState(['alpha', 'beta']);
        const { records } = record(state, { type: CREATE_PAGE, value: null });

        const created = records.filter(r => r.task.type === CREATE_NOTEBOOK_PAGE).map(r => (r.task.value as any[])[1]);
        const renamed = records.filter(r => r.task.type === RENAME_NOTEBOOK_PAGE).map(r => r.task.value);
        // The freshly created (never-flushed) page is written via CREATE, landing last (slot 3).
        expect(created).toEqual(['3_Untitled']);
        // The two persisted siblings are moved in place to gain their prefixes.
        expect(renamed).toEqual([
            [state.sessionId, 'alpha', '1_alpha'],
            [state.sessionId, 'beta', '2_beta'],
        ]);
    });

    it('UPDATE_NOTEBOOK_ENTRY renames the script file in place (no delete + rewrite)', () => {
        const state = buildState();
        const oldFile = Object.keys(getSelectedPage(state)!.scripts)[0];
        const { next, records } = record(state, { type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: oldFile, newFileName: 'renamed' } });

        const newFile = getSortedFileNames(getSelectedPage(next)!)[0];
        expect(newFile).not.toBe(oldFile);
        const renames = records.filter(r => r.task.type === RENAME_NOTEBOOK_SCRIPT).map(r => r.task.value);
        expect(renames).toEqual([[state.sessionId, MAIN_FOLDER, oldFile, newFile]]);
        // No delete of the old file and no content rewrite of either name.
        expect(records.some(r => r.task.type === DELETE_NOTEBOOK_SCRIPT)).toBe(false);
        expect(records.some(r => r.task.type === WRITE_NOTEBOOK_SCRIPT)).toBe(false);
    });

    it('UPDATE_NOTEBOOK_ENTRY without a name change writes content under the unchanged name', () => {
        const state = buildState();
        const file = Object.keys(getSelectedPage(state)!.scripts)[0];
        // Re-submitting the current display name is not a rename.
        const { records } = record(state, { type: UPDATE_NOTEBOOK_ENTRY, value: { fileName: file, newFileName: scriptDisplayName(file) } });
        expect(records.some(r => r.task.type === RENAME_NOTEBOOK_SCRIPT)).toBe(false);
        const written = records.filter(r => r.task.type === WRITE_NOTEBOOK_SCRIPT).map(r => (r.task.value as string[])[2]);
        expect(written).toEqual([file]);
    });
});

// ---------------------------------------------------------------------------
// Script ordering prefix helpers
// ---------------------------------------------------------------------------

describe('script order prefix helpers', () => {
    it('normalizeScriptName removes a leading <digits><sep> prefix, keeping the extension', () => {
        expect(normalizeScriptName('2_extract.sql')).toBe('extract.sql');
        expect(normalizeScriptName('01-script.sql')).toBe('script.sql'); // legacy hyphen
        expect(normalizeScriptName('extract.sql')).toBe('extract.sql');
    });

    it('scriptOrderPrefixString returns the prefix verbatim (with its separator), else empty', () => {
        expect(scriptOrderPrefixString('2_extract.sql')).toBe('2_');
        expect(scriptOrderPrefixString('01-script.sql')).toBe('01-'); // legacy hyphen preserved
        expect(scriptOrderPrefixString('extract.sql')).toBe('');
    });

    it('formatScriptOrderPrefix pads to just the digits the total requires, using "_"', () => {
        expect(formatScriptOrderPrefix(1, 9)).toBe('1_');
        expect(formatScriptOrderPrefix(1, 10)).toBe('01_');
        expect(formatScriptOrderPrefix(12, 12)).toBe('12_');
        expect(formatScriptOrderPrefix(7, 100)).toBe('007_');
    });

    it('scriptDisplayName drops both the ordering prefix AND the ".sql" extension', () => {
        expect(scriptDisplayName('1_foo.sql')).toBe('foo');
        expect(scriptDisplayName('2_extract.sql')).toBe('extract');
        expect(scriptDisplayName('01-script.sql')).toBe('script'); // legacy hyphen
        expect(scriptDisplayName('plain.sql')).toBe('plain');
        expect(scriptDisplayName('noext')).toBe('noext');
    });

    it('uniqueScriptBase disambiguates against existing display names, excluding the renamed file', () => {
        const scripts: { [fileName: string]: NotebookPageScript } = {
            '1_script.sql': createPageScript(1, '1_script.sql'),
            '2_extract.sql': createPageScript(2, '2_extract.sql'),
        };
        expect(uniqueScriptBase('fresh', scripts)).toBe('fresh');
        expect(uniqueScriptBase('script', scripts)).toBe('script-2');
        // Excluding a file lets it keep its own name on a no-op rename.
        expect(uniqueScriptBase('script', scripts, '1_script.sql')).toBe('script');
    });
});

// ---------------------------------------------------------------------------
// planScriptInsertion
// ---------------------------------------------------------------------------

describe('planScriptInsertion', () => {
    function scriptsFromNames(names: string[]): { [fileName: string]: NotebookPageScript } {
        const map: { [fileName: string]: NotebookPageScript } = {};
        names.forEach((name, i) => { map[name] = createPageScript(i + 1, name); });
        return map;
    }

    // These tests pin an explicit base to keep the planning logic (ordering, re-pad) deterministic.
    // The default random base is covered separately below.
    it('names the new script one past the highest prefix so it sorts last', () => {
        const plan = planScriptInsertion(scriptsFromNames(['1_a.sql', '2_b.sql']), 'script');
        expect(plan.newFileName).toBe('3_script.sql');
        expect(plan.repad).toEqual([]);
    });

    it('disambiguates the requested base against an existing clash', () => {
        const plan = planScriptInsertion(scriptsFromNames(['1_script.sql']), 'script');
        expect(plan.newFileName).toBe('2_script-2.sql');
    });

    it('re-pads existing scripts to a wider prefix when the digit count grows', () => {
        // 9 existing single-digit scripts; inserting the 10th widens the prefix to 2 digits.
        const names = Array.from({ length: 9 }, (_, i) => `${i + 1}_s${i + 1}.sql`);
        const plan = planScriptInsertion(scriptsFromNames(names), 'script');
        expect(plan.newFileName).toBe('10_script.sql');
        // Every existing script is re-padded to width 2, keeping its number and clean name.
        expect(plan.repad).toEqual(names.map((name, i) => ({
            oldFileName: name,
            newFileName: `0${i + 1}_s${i + 1}.sql`,
        })));
    });

    it('normalises legacy hyphen-separated names while re-padding', () => {
        const names = ['01-a.sql', '02-b.sql'];
        const plan = planScriptInsertion(scriptsFromNames(names), 'script');
        // Adding a 3rd script keeps width 1, but the legacy "0N-" entries normalise to "N_".
        expect(plan.newFileName).toBe('3_script.sql');
        expect(plan.repad).toEqual([
            { oldFileName: '01-a.sql', newFileName: '1_a.sql' },
            { oldFileName: '02-b.sql', newFileName: '2_b.sql' },
        ]);
    });

    it('appends at the bottom even when prefixes are sparse', () => {
        const plan = planScriptInsertion(scriptsFromNames(['1_a.sql', '5_b.sql']), 'script');
        expect(plan.newFileName).toBe('6_script.sql');
    });

    it('defaults to a random "<adjective>_<animal>" base when none is requested', () => {
        const plan = planScriptInsertion(scriptsFromNames(['1_a.sql', '2_b.sql']));
        // Sorts last (prefix 3) and carries an underscore-joined two-word clean name, not "script".
        expect(plan.newFileName).toMatch(/^3_[a-z]+_[a-z]+\.sql$/);
        expect(scriptDisplayName(plan.newFileName)).not.toBe('script');
    });
});

// ---------------------------------------------------------------------------
// REORDER_NOTEBOOK_SCRIPTS
// ---------------------------------------------------------------------------

// Builds a single 'Main' page holding scripts at the given file names, each seeded with SQL.
function buildScriptState(fileNames: string[]): NotebookState {
    const state = buildState();
    const scripts: NotebookState['scripts'] = {
        [state.uncommittedScriptId]: state.scripts[state.uncommittedScriptId],
    };
    const pageScripts: { [fileName: string]: NotebookPageScript } = {};
    for (const fileName of fileNames) {
        const [key, data] = createEmptyScriptData(state.instance, state.connectionCatalog);
        data.script.insertTextAt(0, 'SELECT 1 as x');
        scripts[key] = { ...data, folderName: MAIN_FOLDER, fileName };
        pageScripts[fileName] = createPageScript(key, fileName);
    }
    return {
        ...state,
        scripts,
        notebookPages: { [MAIN_FOLDER]: { folderName: MAIN_FOLDER, scripts: pageScripts } },
        notebookUserFocus: { folderName: MAIN_FOLDER, fileName: fileNames[0] ?? '', interactionCounter: 0 },
    };
}

describe('REORDER_NOTEBOOK_SCRIPTS', () => {
    it('assigns dense ordering prefixes that sort to the requested order', () => {
        const state = buildScriptState(['1_a.sql', '2_b.sql', '3_c.sql']);
        const next = reduce(state, { type: REORDER_NOTEBOOK_SCRIPTS, value: ['3_c.sql', '1_a.sql', '2_b.sql'] });
        const files = getSortedFileNames(getSelectedPage(next)!);
        expect(files).toEqual(['1_c.sql', '2_a.sql', '3_b.sql']);
        expect(files.map(scriptDisplayName)).toEqual(['c', 'a', 'b']);
    });

    it('keeps the clean (SQL-visible) reference namespace stable across a reorder', () => {
        const state = buildScriptState(['1_a.sql', '2_b.sql']);
        const bFile = '2_b.sql';
        const bScriptId = state.notebookPages[MAIN_FOLDER].scripts[bFile].scriptId;

        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: bScriptId });
        expect(s1.scripts[bScriptId].annotations.tableDefs).toContain(`${MAIN_FOLDER}/b`);

        // Move b to the front: its prefix changes (2_ -> 1_) but its clean name stays "b".
        const s2 = reduce(s1, { type: REORDER_NOTEBOOK_SCRIPTS, value: ['2_b.sql', '1_a.sql'] });
        const movedFile = getSortedFileNames(getSelectedPage(s2)!)[0];
        expect(scriptDisplayName(movedFile)).toBe('b');
        expect(movedFile).not.toBe(bFile);

        const s3 = reduce(s2, { type: ANALYZE_OUTDATED_SCRIPT, value: bScriptId });
        expect(s3.scripts[bScriptId].annotations.tableDefs).toContain(`${MAIN_FOLDER}/b`);
    });

    it('is a no-op when the requested order matches the current feed order', () => {
        const state = buildScriptState(['1_a.sql', '2_b.sql', '3_c.sql']);
        const next = reduce(state, { type: REORDER_NOTEBOOK_SCRIPTS, value: ['1_a.sql', '2_b.sql', '3_c.sql'] });
        expect(next).toBe(state);
    });

    it('appends omitted files after the requested ones without dropping any', () => {
        const state = buildScriptState(['1_a.sql', '2_b.sql', '3_c.sql']);
        const next = reduce(state, { type: REORDER_NOTEBOOK_SCRIPTS, value: ['3_c.sql'] });
        const files = getSortedFileNames(getSelectedPage(next)!);
        expect(files.map(scriptDisplayName)).toEqual(['c', 'a', 'b']);
    });

    it('follows the focused file across its rename', () => {
        const state = buildScriptState(['1_a.sql', '2_b.sql', '3_c.sql']);
        const s1 = reduce(state, { type: SELECT_ENTRY, value: '3_c.sql' });
        expect(s1.notebookUserFocus.fileName).toBe('3_c.sql');
        const s2 = reduce(s1, { type: REORDER_NOTEBOOK_SCRIPTS, value: ['3_c.sql', '1_a.sql', '2_b.sql'] });
        expect(scriptDisplayName(s2.notebookUserFocus.fileName)).toBe('c');
        expect(getSelectedPage(s2)!.scripts[s2.notebookUserFocus.fileName]).toBeDefined();
    });

    it('normalises legacy hyphen-separated names to the "_" form on reorder', () => {
        const state = buildScriptState(['01-a.sql', '02-b.sql']);
        const next = reduce(state, { type: REORDER_NOTEBOOK_SCRIPTS, value: ['02-b.sql', '01-a.sql'] });
        const files = getSortedFileNames(getSelectedPage(next)!);
        expect(files).toEqual(['1_b.sql', '2_a.sql']);
    });

    it('is a no-op when there is no selected page', () => {
        const state = buildScriptState(['1_a.sql']);
        const headless: NotebookState = { ...state, notebookPages: {}, notebookUserFocus: { folderName: '', fileName: '', interactionCounter: 0 } };
        const next = reduce(headless, { type: REORDER_NOTEBOOK_SCRIPTS, value: ['1_a.sql'] });
        expect(next).toBe(headless);
    });

    it('never deletes a path that another script is being written to (clean-name collision)', () => {
        // Two scripts in one page share the clean name "script" (the legacy default, and what the
        // re-pad normaliser produces). Swapping them maps each one's new path onto the other's old
        // path. Because deletes and writes use distinct keyspaces, scheduling a delete for a path that
        // is also a write target would race the write and could clobber the file on disk — so the
        // delete for any reused path must be suppressed.
        const recorder = new RecordingStorageWriter(logger, backend);
        const state = buildScriptState(['1_script.sql', '2_script.sql']);
        const next = reduceNotebookState(
            state,
            { type: REORDER_NOTEBOOK_SCRIPTS, value: ['2_script.sql', '1_script.sql'] },
            recorder,
            logger,
            true,
        );

        // In-memory order is swapped and both clean names are preserved.
        const files = getSortedFileNames(getSelectedPage(next)!);
        expect(files).toEqual(['1_script.sql', '2_script.sql']);
        expect(files.map(scriptDisplayName)).toEqual(['script', 'script']);

        const written = new Set(
            recorder.records.filter(r => r.task.type === WRITE_NOTEBOOK_SCRIPT).map(r => (r.task.value as string[])[2]),
        );
        const deleted = new Set(
            recorder.records.filter(r => r.task.type === DELETE_NOTEBOOK_SCRIPT).map(r => (r.task.value as string[])[2]),
        );
        // Both paths are (re)written, and neither is deleted — no write can be shadowed by a delete.
        expect([...written].sort()).toEqual(['1_script.sql', '2_script.sql']);
        for (const path of written) {
            expect(deleted.has(path)).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// CREATE_NOTEBOOK_ENTRY appends at the bottom with re-pad
// ---------------------------------------------------------------------------

describe('CREATE_NOTEBOOK_ENTRY ordering', () => {
    it('adds the new script at the bottom of the feed', () => {
        const state = buildScriptState(['1_a.sql', '2_b.sql']);
        const next = reduce(state, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const files = getSortedFileNames(getSelectedPage(next)!);
        expect(files[files.length - 1]).toBe(next.notebookUserFocus.fileName);
        // The new bottom script sorts after the existing two.
        expect(files.map(scriptDisplayName).slice(0, 2)).toEqual(['a', 'b']);
    });

    it('re-pads existing scripts to a uniform width when the 10th script is added', () => {
        const names = Array.from({ length: 9 }, (_, i) => `${i + 1}_s${i + 1}.sql`);
        const state = buildScriptState(names);
        const next = reduce(state, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const files = getSortedFileNames(getSelectedPage(next)!);
        expect(files.length).toBe(10);
        // The existing 9 scripts now carry a 2-digit prefix; feed order is preserved. The 10th gets a
        // random base, so only its prefix and ".sql" extension are pinned here.
        expect(files.slice(0, 9)).toEqual([
            '01_s1.sql', '02_s2.sql', '03_s3.sql', '04_s4.sql', '05_s5.sql',
            '06_s6.sql', '07_s7.sql', '08_s8.sql', '09_s9.sql',
        ]);
        expect(files[9]).toMatch(/^10_.+\.sql$/);
        // The clean names are unchanged by re-padding (the SQL namespace stays stable).
        expect(files.slice(0, 9).map(scriptDisplayName)).toEqual([
            's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9',
        ]);
    });
});

// ---------------------------------------------------------------------------
// makeScriptLookup / clean-name references
// ---------------------------------------------------------------------------

describe('clean-name script references', () => {
    it('resolves a VISUALIZE reference written against the clean folder/file name', () => {
        // Source script "1_a.sql" in "Main" is referenced as dashql.notebook."Main/a".
        const state = buildScriptState(['1_a.sql']);
        const sourceId = state.notebookPages[MAIN_FOLDER].scripts['1_a.sql'].scriptId;
        const s1 = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey: sourceId, text: 'SELECT 1 as a' } });

        const visualize = `visualize dashql.notebook."${MAIN_FOLDER}/a" as ( mark => bar, encoding => ( x => (field => a) ) )`;
        const s2 = reduce(s1, { type: CREATE_NOTEBOOK_ENTRY_WITH_TEXT, value: { text: visualize } });
        const focusFile = s2.notebookUserFocus.fileName;
        const visId = getSelectedPage(s2)!.scripts[focusFile].scriptId;
        expect(s2.scripts[visId].annotations.visualizeQuery).not.toBeNull();
        expect(s2.scripts[visId].annotations.visualizeQuery!.sql.toLowerCase()).toContain('select 1 as a');
    });

    it('a clean-name reference still resolves after the source script is reordered', () => {
        const state = buildScriptState(['1_a.sql', '2_b.sql']);
        const aId = state.notebookPages[MAIN_FOLDER].scripts['1_a.sql'].scriptId;
        const s1 = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey: aId, text: 'SELECT 1 as a' } });

        // A third script visualises "Main/a" by its clean name.
        const visualize = `visualize dashql.notebook."${MAIN_FOLDER}/a" as ( mark => bar, encoding => ( x => (field => a) ) )`;
        const s2 = reduce(s1, { type: CREATE_NOTEBOOK_ENTRY_WITH_TEXT, value: { text: visualize } });
        const visFile = s2.notebookUserFocus.fileName;
        const visId = getSelectedPage(s2)!.scripts[visFile].scriptId;
        expect(s2.scripts[visId].annotations.visualizeQuery).not.toBeNull();

        // Reorder so "a" moves to the bottom (its prefix changes), then re-analyze the vis script.
        const order = getSortedFileNames(getSelectedPage(s2)!).filter(f => scriptDisplayName(f) !== 'a');
        const s3 = reduce(s2, { type: REORDER_NOTEBOOK_SCRIPTS, value: [...order, '1_a.sql'] });
        const visFileAfter = getSortedFileNames(getSelectedPage(s3)!).find(f => getSelectedPage(s3)!.scripts[f].scriptId === visId)!;
        const s4 = reduce(s3, { type: SET_SCRIPT_TEXT, value: { scriptKey: visId, text: s3.scripts[visId].script.toString() } });
        // The reference still resolves because it points at the stable clean name "Main/a".
        expect(s4.scripts[visId].annotations.visualizeQuery).not.toBeNull();
        void visFileAfter;
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
// getExecutableQueryText
// ---------------------------------------------------------------------------

describe('getExecutableQueryText', () => {
    const VISUALIZE_SCRIPT =
        'visualize ( select v as a from generate_series(1, 10) t(v) ) as ( mark => bar, encoding => ( x => (field => a) ) )';

    it('extracts the inner SELECT from a VISUALIZE script even when analysis is still outdated', () => {
        // Reproduces the first-run race: the script was just inserted and not
        // analyzed yet, so annotations.visualizeQuery is null. We must still
        // send the inner SELECT to the backend, not the raw `visualize (...)`.
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const scriptData = state.scripts[scriptKey];
        scriptData.script.insertTextAt(0, VISUALIZE_SCRIPT);

        expect(scriptData.scriptAnalysis.outdated).toBe(true);
        expect(scriptData.annotations.visualizeQuery).toBeNull();

        const text = getExecutableQueryText(state, scriptData);
        expect(text.toLowerCase()).not.toContain('visualize');
        expect(text.toLowerCase()).toContain('select v as a');
    });

    it('extracts the inner SELECT once the script has been analyzed', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        state.scripts[scriptKey].script.insertTextAt(0, VISUALIZE_SCRIPT);

        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptKey });
        const scriptData = s1.scripts[scriptKey];
        expect(scriptData.scriptAnalysis.outdated).toBe(false);
        expect(scriptData.annotations.visualizeQuery?.sql).toBeDefined();

        const text = getExecutableQueryText(s1, scriptData);
        expect(text.toLowerCase()).not.toContain('visualize');
        expect(text.toLowerCase()).toContain('select v as a');
    });

    it('returns the raw script text for a plain SQL statement', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const scriptData = state.scripts[scriptKey];
        scriptData.script.insertTextAt(0, 'SELECT 1 as x');

        const text = getExecutableQueryText(state, scriptData);
        expect(text).toBe('SELECT 1 as x');
    });

    it('re-resolves a SCRIPT_REFERENCE against the source script\'s current text', () => {
        // Regression: a `visualize dashql.notebook."Main/a"` embeds the *current*
        // text of source script "a". Editing "a" only marks the vis script
        // outdated; it does not re-derive its cached visualizeQuery. Re-executing
        // the vis must still pick up the edited source, not the stale snapshot.
        const state = buildScriptState(['1_a.sql']);
        const sourceId = state.notebookPages[MAIN_FOLDER].scripts['1_a.sql'].scriptId;
        const s1 = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey: sourceId, text: 'select v as a from generate_series(1, 100) t(v)' } });

        const visualize = `visualize dashql.notebook."${MAIN_FOLDER}/a" as ( mark => line, encoding => ( x => (field => a) ) )`;
        const s2 = reduce(s1, { type: CREATE_NOTEBOOK_ENTRY_WITH_TEXT, value: { text: visualize } });
        const visId = getSelectedPage(s2)!.scripts[s2.notebookUserFocus.fileName].scriptId;

        // The vis resolves against the source's initial text.
        expect(getExecutableQueryText(s2, s2.scripts[visId]).toLowerCase()).toContain('generate_series(1, 100)');

        // Edit the source script's range; the vis script is now marked outdated but its cached SQL is stale.
        const s3 = reduce(s2, { type: SET_SCRIPT_TEXT, value: { scriptKey: sourceId, text: 'select v as a from generate_series(1, 1) t(v)' } });
        expect(s3.scripts[visId].scriptAnalysis.outdated).toBe(true);
        expect(s3.scripts[visId].annotations.visualizeQuery!.sql.toLowerCase()).toContain('generate_series(1, 100)');

        // Re-executing the vis must reflect the edited source, not the stale cache.
        const executed = getExecutableQueryText(s3, s3.scripts[visId]).toLowerCase();
        expect(executed).toContain('generate_series(1, 1)');
        expect(executed).not.toContain('generate_series(1, 100)');
    });
});

// ---------------------------------------------------------------------------
// analyzeAllScriptsInNotebook / getScriptKeysInFeedOrder
// ---------------------------------------------------------------------------

describe('getScriptKeysInFeedOrder', () => {
    it('orders pages top-down (sorted folders, sorted files) then the uncommitted script', () => {
        // buildState gives one Main page with one entry + an uncommitted script.
        // Add a second page and a second entry on Main to exercise the ordering.
        let state = buildState();
        const mainFile = state.notebookUserFocus.fileName;
        state = reduce(state, { type: CREATE_NOTEBOOK_ENTRY, value: null }); // 2nd entry on Main
        state = reduce(state, { type: CREATE_PAGE, value: null }); // 'Untitled' page + auto script

        const order = getScriptKeysInFeedOrder(state);

        // Build the expected order independently from the page maps.
        const expected: number[] = [];
        for (const folder of getSortedFolderNames(state.notebookPages)) {
            const page = state.notebookPages[folder];
            for (const file of getSortedFileNames(page)) {
                expected.push(page.scripts[file].scriptId);
            }
        }
        expected.push(state.uncommittedScriptId);

        expect(order).toEqual(expected);
        // 'Main' sorts before 'Untitled', so the original Main entry comes first. CREATE_PAGE
        // re-prefixed the page ('Main' -> '1_Main'), so resolve it under its current name.
        const mainFolder = getSortedFolderNames(state.notebookPages)[0];
        const mainFirstScriptId = state.notebookPages[mainFolder].scripts[mainFile].scriptId;
        expect(order[0]).toBe(mainFirstScriptId);
        // The uncommitted composer script is always last.
        expect(order[order.length - 1]).toBe(state.uncommittedScriptId);
    });

    it('has no duplicates and covers every script', () => {
        let state = buildState();
        state = reduce(state, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const order = getScriptKeysInFeedOrder(state);
        expect(new Set(order).size).toBe(order.length);
        expect(new Set(order)).toEqual(new Set(Object.keys(state.scripts).map(Number)));
    });
});

describe('analyzeAllScriptsInNotebook', () => {
    it('analyzes every script in a single pass and reports per-script progress', () => {
        let state = buildState();
        state = reduce(state, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        // Seed real SQL so analysis produces non-null buffers.
        for (const key of Object.keys(state.scripts)) {
            state.scripts[+key].script.replaceText('SELECT 1 as x');
        }

        const counts: boolean[] = [];
        let reportedTotal = -1;
        const next = analyzeAllScriptsInNotebook(state, logger, {
            onScriptCount: (n) => { reportedTotal = n; },
            onScriptDone: (ok) => { counts.push(ok); },
        });

        const scriptCount = Object.keys(state.scripts).length;
        expect(reportedTotal).toBe(scriptCount);
        expect(counts.length).toBe(scriptCount);
        expect(counts.every(Boolean)).toBe(true);
        // Every script now has an analyzed copy and is no longer outdated.
        for (const key of Object.keys(next.scripts)) {
            expect(next.scripts[+key].scriptAnalysis.outdated).toBe(false);
            expect(next.scripts[+key].scriptAnalysis.buffers.analyzed).not.toBeNull();
        }
    });

    it('resolves an upward SCRIPT_REFERENCE in a single pass', () => {
        // A later entry references an earlier one by notebook path. Because we
        // analyze top-down, the source is already in the catalog when the
        // referencing visualize entry is analyzed - no second pass needed.
        let state = buildState();
        const sourceFile = state.notebookUserFocus.fileName;
        state.scripts[state.notebookPages[MAIN_FOLDER].scripts[sourceFile].scriptId]
            .script.replaceText('SELECT 1 as a');

        const s1 = reduce(state, {
            type: CREATE_NOTEBOOK_ENTRY_WITH_TEXT,
            value: { text: `visualize dashql.notebook."${MAIN_FOLDER}/${sourceFile}" as ( mark => bar, encoding => ( x => (field => a) ) )` },
        });

        const next = analyzeAllScriptsInNotebook(s1, logger);

        const visFile = next.notebookUserFocus.fileName;
        const visScriptId = next.notebookPages[MAIN_FOLDER].scripts[visFile].scriptId;
        expect(next.scripts[visScriptId].annotations.visualizeQuery).not.toBeNull();
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

// ---------------------------------------------------------------------------
// SET_SCRIPT_TEXT
// ---------------------------------------------------------------------------

describe('SET_SCRIPT_TEXT', () => {
    it('rewrites the script text in-place', () => {
        const state = buildState();
        const scriptKey = getSelectedPage(state)!.scripts[state.notebookUserFocus.fileName].scriptId;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: 'SELECT 1 as x' } });
        expect(next.scripts[scriptKey].script.toString()).toBe('SELECT 1 as x');
    });

    it('re-analyzes the rewritten script', () => {
        const state = buildState();
        const scriptKey = getSelectedPage(state)!.scripts[state.notebookUserFocus.fileName].scriptId;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: 'SELECT 1 as x, 2 as y' } });
        expect(next.scripts[scriptKey].scriptAnalysis.outdated).toBe(false);
        expect(next.scripts[scriptKey].scriptAnalysis.buffers.analyzed).not.toBeNull();
        // The script is registered in the catalog under its clean notebook path (no prefix, no ".sql")
        expect(next.scripts[scriptKey].annotations.tableDefs).toContain(`${MAIN_FOLDER}/${scriptDisplayName(state.notebookUserFocus.fileName)}`);
    });

    it('refreshes the resolved VISUALIZE annotation', () => {
        const state = buildState();
        const scriptKey = getSelectedPage(state)!.scripts[state.notebookUserFocus.fileName].scriptId;
        const visualize =
            'visualize ( select v as a from generate_series(1, 10) t(v) ) as ( mark => bar, encoding => ( x => (field => a) ) )';
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: visualize } });
        expect(next.scripts[scriptKey].annotations.visualizeQuery).not.toBeNull();
        expect(next.scripts[scriptKey].annotations.visualizeQuery!.sql.toLowerCase()).toContain('select v as a');
    });

    it('marks other scripts outdated', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        // Analyze every script first so we can observe the outdated flip
        let state = s1;
        for (const key of Object.keys(state.scripts)) {
            state = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: +key });
        }
        const targetKey = +Object.keys(state.scripts)[0];
        const otherKey = +Object.keys(state.scripts).find(k => +k !== targetKey)!;
        expect(state.scripts[otherKey].scriptAnalysis.outdated).toBe(false);

        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey: targetKey, text: 'SELECT 1' } });
        expect(next.scripts[targetKey].scriptAnalysis.outdated).toBe(false);
        expect(next.scripts[otherKey].scriptAnalysis.outdated).toBe(true);
    });

    it('is a no-op for an unknown scriptKey', () => {
        const state = buildState();
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey: 99999, text: 'SELECT 1' } });
        expect(next).toBe(state);
    });
});

// ---------------------------------------------------------------------------
// CREATE_NOTEBOOK_ENTRY_WITH_TEXT
// ---------------------------------------------------------------------------

describe('CREATE_NOTEBOOK_ENTRY_WITH_TEXT', () => {
    it('appends a new entry seeded with the provided text', () => {
        const state = buildState();
        const prevCount = pageEntryCount(state);
        const next = reduce(state, { type: CREATE_NOTEBOOK_ENTRY_WITH_TEXT, value: { text: 'SELECT 1 as x' } });
        expect(pageEntryCount(next)).toBe(prevCount + 1);
        const focusFile = next.notebookUserFocus.fileName;
        const newEntry = getSelectedPage(next)!.scripts[focusFile];
        expect(next.scripts[newEntry.scriptId].script.toString()).toBe('SELECT 1 as x');
    });

    it('analyzes the new entry before returning', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_NOTEBOOK_ENTRY_WITH_TEXT, value: { text: 'SELECT 1 as x, 2 as y' } });
        const focusFile = next.notebookUserFocus.fileName;
        const newEntry = getSelectedPage(next)!.scripts[focusFile];
        expect(next.scripts[newEntry.scriptId].scriptAnalysis.outdated).toBe(false);
        expect(next.scripts[newEntry.scriptId].scriptAnalysis.buffers.analyzed).not.toBeNull();
    });

    it('moves focus to the newly created entry', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_NOTEBOOK_ENTRY_WITH_TEXT, value: { text: 'SELECT 1' } });
        const files = getSortedFileNames(getSelectedPage(next)!);
        expect(next.notebookUserFocus.fileName).toBe(files[files.length - 1]);
    });

    it('resolves a VISUALIZE script-reference to an existing entry', () => {
        const state = buildState();
        const sourceFile = state.notebookUserFocus.fileName;
        // Give the focused entry a SELECT so it can be referenced by path
        const s1 = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey: getSelectedPage(state)!.scripts[sourceFile].scriptId, text: 'SELECT 1 as a' } });
        // Script references are encoded as `dashql.notebook."<folder>/<file>"`.
        const visualize = `visualize dashql.notebook."${MAIN_FOLDER}/${sourceFile}" as ( mark => bar, encoding => ( x => (field => a) ) )`;
        const s2 = reduce(s1, { type: CREATE_NOTEBOOK_ENTRY_WITH_TEXT, value: { text: visualize } });
        const focusFile = s2.notebookUserFocus.fileName;
        const newEntry = getSelectedPage(s2)!.scripts[focusFile];
        expect(s2.scripts[newEntry.scriptId].annotations.visualizeQuery).not.toBeNull();
    });
});

// ---------------------------------------------------------------------------
// destroyState (notebook teardown on session delete)
// ---------------------------------------------------------------------------

describe('destroyState', () => {
    // A live Wasm Ptr is registered in core.registeredMemory under its resultPtr; destroy()
    // unregisters it. So "is this object still alive?" reduces to a registry membership check.
    function isAlive(ptr: { resultPtr: number | null }): boolean {
        return ptr.resultPtr != null && dql!.registeredMemory.has(ptr.resultPtr);
    }

    it('frees the script registry and every owned script', () => {
        const state = buildState();
        const scriptPtrs = Object.values(state.scripts).map(s => s.script.ptr);
        const registryPtr = state.scriptRegistry.ptr!;

        // Everything is alive before teardown.
        expect(isAlive(registryPtr)).toBe(true);
        for (const p of scriptPtrs) {
            expect(isAlive(p)).toBe(true);
        }

        destroyState(state);

        // The notebook-owned Wasm is gone.
        expect(isAlive(registryPtr)).toBe(false);
        for (const p of scriptPtrs) {
            expect(isAlive(p)).toBe(false);
        }
    });

    it('leaves the shared connection catalog alive (it is owned by the connection)', () => {
        const state = buildState();
        const catalogPtr = state.connectionCatalog.ptr!;

        destroyState(state);

        // destroyState drops the notebook's scripts FROM the catalog but must never destroy the
        // catalog itself — the connection owns it and DELETE_CONNECTION frees it separately.
        expect(isAlive(catalogPtr)).toBe(true);

        // Cleanup the catalog we created for this test.
        state.connectionCatalog.destroy();
    });
});

// Reference to keep imports used if other helpers are not consumed
void pageEntries;
