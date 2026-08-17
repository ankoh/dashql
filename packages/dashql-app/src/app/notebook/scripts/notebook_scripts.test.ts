import * as core from '../../../shared/core/index.js';

import {
    reduceNotebookScripts,
    NotebookScripts,
    createEmptyScriptData,
    ACCEPT_PENDING_DIFF,
    REJECT_PENDING_DIFF,
    ANALYZE_OUTDATED_SCRIPT,
    CATALOG_DID_UPDATE,
    CREATE_SCRIPT,
    CREATE_SCRIPT_WITH_TEXT,
    CREATE_SCRIPT_FOLDER,
    DELETE_SCRIPT,
    PROMOTE_UNCOMMITTED_SCRIPT,
    REGISTER_QUERY,
    REGISTER_AGENT_RUN,
    SELECT_SCRIPT,
    SELECT_SCRIPT_PATH,
    SET_SCRIPT_TEXT,
    destroyNotebookScripts,
    compileQuery,
    getScriptKeysInFeedOrder,
    analyzeAllScripts,
    SELECT_NEXT_SCRIPT,
    SELECT_NEXT_SCRIPT_FOLDER,
    SELECT_SCRIPT_FOLDER,
    SELECT_PREV_SCRIPT,
    SELECT_PREV_SCRIPT_FOLDER,
    RENAME_SCRIPT,
    RENAME_SCRIPT_FOLDER,
    REORDER_SCRIPT_FOLDERS,
    REORDER_SCRIPTS,
    getSelectedScriptFolder,
    getSelectedScriptRefs,
    getSortedScriptFileNames,
    getSortedScriptFolderNames,
    notebookScriptsMatchStorageSnapshot,
    replaceNotebookScriptsFromStorage,
} from './notebook_scripts.js';
import { CONNECTOR_INFOS, ConnectorType, createDatalessConnectorInfo } from '../connections/connector_info.js';
import {
    StorageWriter,
    StorageWriteTaskVariant,
    WRITE_SCRIPT,
    DELETE_SCRIPT as STORAGE_DELETE_SCRIPT,
    RENAME_SCRIPT_FOLDER as STORAGE_RENAME_SCRIPT_FOLDER,
    RENAME_SCRIPT as STORAGE_RENAME_SCRIPT,
    CREATE_SCRIPT_FOLDER as STORAGE_CREATE_SCRIPT_FOLDER,
    DELETE_SCRIPT_FOLDER as STORAGE_DELETE_SCRIPT_FOLDER,
} from "../persistence/storage_writer.js";
import { Logger } from '../../../shared/platform/logger/logger.js';
import { createEmptyMetadata, createScriptRef, generateScriptFileName, normalizeScriptFolderName, scriptFolderOrderPrefixString, formatScriptFolderOrderPrefix, normalizeScriptName, scriptOrderPrefixString, formatScriptOrderPrefix, scriptDisplayName, uniqueScriptBase, planScriptInsertion, ScriptRef } from './script_types.js';
import { type AppSettings, type NotebookData, type NotebookEntry, type ScriptData as StoredScriptData, type ScriptFolderData, type StorageBackend, StorageBackendType } from '../persistence/storage_backend.js';

class NullLogger extends Logger {
    public destroy(): void { }
    protected flushPendingRecords(): void { }
}

class NullStorageBackend implements StorageBackend {
    getBackendType(): StorageBackendType { return StorageBackendType.OPFS; }
    async listNotebooks(_manifestPath: string): Promise<NotebookEntry[]> { return []; }
    async loadAppSettings(): Promise<AppSettings | null> { return null; }
    async saveAppSettings(_settings: AppSettings): Promise<void> { }
    async loadNotebook(_notebookId: string): Promise<NotebookData> { return {} as NotebookData; }
    async saveNotebookManifest(_notebookId: string, _data: NotebookData): Promise<void> { }
    async deleteNotebook(_notebookId: string): Promise<void> { }
    async loadNotebookSchema(_notebookId: string): Promise<string | null> { return null; }
    async saveNotebookSchema(_notebookId: string, _sql: string): Promise<void> { }
    async loadNotebookFunctions(_notebookId: string): Promise<string | null> { return null; }
    async saveNotebookFunctions(_notebookId: string, _sql: string): Promise<void> { }
    async loadScriptFolders(_notebookId: string): Promise<ScriptFolderData[]> { return []; }
    async createScriptFolder(_notebookId: string, _folderName: string): Promise<void> { }
    async deleteScriptFolder(_notebookId: string, _folderName: string): Promise<void> { }
    async renameScriptFolder(_notebookId: string, _oldFolderName: string, _newFolderName: string): Promise<void> { }
    async loadScript(_notebookId: string, _folderName: string, _scriptName: string): Promise<StoredScriptData> { return {} as StoredScriptData; }
    async saveScript(_notebookId: string, _folderName: string, _scriptName: string, _sql: string): Promise<void> { }
    async deleteScript(_notebookId: string, _folderName: string, _scriptName: string): Promise<void> { }
    async renameScript(_notebookId: string, _folderName: string, _oldScriptName: string, _newScriptName: string): Promise<void> { }
    async loadScriptDraft(_notebookId: string): Promise<string | null> { return null; }
    async saveScriptDraft(_notebookId: string, _sql: string): Promise<void> { }
    async loadQueryResultCache(_notebookId: string, _hash: string): Promise<null> { return null; }
    async touchQueryResultCacheAccess(_notebookId: string, _hash: string): Promise<void> { }
    async hasCachedQueryResult(): Promise<boolean> { return false; }
    async saveQueryResultCache(_notebookId: string, _hash: string, _bytes: Uint8Array): Promise<void> { }
    async listQueryResultCache(_notebookId: string): Promise<[]> { return []; }
    async deleteQueryResultCache(_notebookId: string, _hash: string): Promise<void> { }
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
const backend = new NullStorageBackend();
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

// Builds a minimal DEMO-connector NotebookScripts with a single 'Main' page
// containing one committed script and a separate uncommitted script.
function buildState(): NotebookScripts {
    const catalog = dql!.createCatalog();
    const [committedKey, committedData] = createEmptyScriptData(dql!, catalog);
    const [uncommittedKey, uncommittedData] = createEmptyScriptData(dql!, catalog);
    const notebookId = crypto.randomUUID();
    const initialFile = generateScriptFileName({});
    return {
        instance: dql!,
        notebookId,
        connectionId: crypto.randomUUID(),
        notebookMetadata: createEmptyMetadata(),
        connectorInfo: createDatalessConnectorInfo(true),
        connectionCatalog: catalog,
        scripts: {
            [committedKey]: { ...committedData, folderName: MAIN_FOLDER, fileName: initialFile },
            [uncommittedKey]: uncommittedData,
        },
        scriptFolders: {
            [MAIN_FOLDER]: {
                folderName: MAIN_FOLDER,
                scripts: {
                    [initialFile]: createScriptRef(committedKey, initialFile),
                },
            },
        },
        uncommittedScriptId: uncommittedKey,
        scriptFocus: { folderName: MAIN_FOLDER, fileName: initialFile, interactionCounter: 0 },
        semanticUserFocus: null,
    };
}

describe('external storage replacement', () => {
    it('detects page-only structural changes', () => {
        const state = buildState();
        const fileName = state.scriptFocus.fileName;
        expect(notebookScriptsMatchStorageSnapshot(state, {
            folders: [{ name: 'Renamed', scripts: [{ name: fileName, sql: '' }] }],
            draft: null,
        })).toBe(false);
        destroyNotebookScripts(state);
        state.connectionCatalog.destroy();
    });

    it('reuses same-path scripts and replaces added, removed, and changed content', () => {
        const state = buildState();
        const oldFile = state.scriptFocus.fileName;
        const retained = state.scripts[state.scriptFolders[MAIN_FOLDER].scripts[oldFile].scriptId];
        retained.script.replaceText('SELECT 1');

        const next = replaceNotebookScriptsFromStorage(state, {
            folders: [{
                name: MAIN_FOLDER,
                scripts: [
                    { name: oldFile, sql: 'SELECT 2' },
                    { name: '2_added.sql', sql: 'SELECT 3' },
                ],
            }],
            draft: 'SELECT 4',
        }, logger);

        const retainedAfter = next.scripts[next.scriptFolders[MAIN_FOLDER].scripts[oldFile].scriptId];
        expect(retainedAfter.script.ptr).toBe(retained.script.ptr);
        expect(retainedAfter.script.toString()).toBe('SELECT 2');
        expect(next.scripts[next.scriptFolders[MAIN_FOLDER].scripts['2_added.sql'].scriptId].script.toString()).toBe('SELECT 3');
        expect(next.scripts[next.uncommittedScriptId].script.toString()).toBe('SELECT 4');
        expect(notebookScriptsMatchStorageSnapshot(next, {
            folders: [{
                name: MAIN_FOLDER,
                scripts: [
                    { name: oldFile, sql: 'SELECT 2' },
                    { name: '2_added.sql', sql: 'SELECT 3' },
                ],
            }],
            draft: 'SELECT 4',
        })).toBe(true);

        destroyNotebookScripts(next);
        next.connectionCatalog.destroy();
    });
});

function reduce(state: NotebookScripts, action: Parameters<typeof reduceNotebookScripts>[1]): NotebookScripts {
    return reduceNotebookScripts(state, action, storage, logger, true);
}

function pageEntries(state: NotebookScripts) {
    return getSelectedScriptRefs(state);
}

function pageEntryCount(state: NotebookScripts) {
    const page = getSelectedScriptFolder(state);
    return page ? Object.keys(page.scripts).length : 0;
}

function folderNames(state: NotebookScripts) {
    return getSortedScriptFolderNames(state.scriptFolders);
}

// ---------------------------------------------------------------------------
// SELECT_SCRIPT_FOLDER
// ---------------------------------------------------------------------------

describe('SELECT_SCRIPT_FOLDER', () => {
    it('navigates to a valid folder name', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_SCRIPT_FOLDER, value: null });
        expect(folderNames(s1).length).toBe(2);
        // Creating a page re-prefixes the original page (e.g. "Main" -> "1_Main"); navigate to it
        // under its current (prefixed) name.
        const mainFolder = folderNames(s1)[0];
        const s2 = reduce(s1, { type: SELECT_SCRIPT_FOLDER, value: mainFolder });
        expect(s2.scriptFocus.folderName).toBe(mainFolder);
    });

    it('is a no-op for an unknown folder name', () => {
        const state = buildState();
        const next = reduce(state, { type: SELECT_SCRIPT_FOLDER, value: 'Nonexistent' });
        expect(next).toBe(state);
    });

    it('clears semanticUserFocus', () => {
        const state: NotebookScripts = {
            ...buildState(),
            semanticUserFocus: {} as any,
        };
        const next = reduce(state, { type: SELECT_SCRIPT_FOLDER, value: MAIN_FOLDER });
        expect(next.semanticUserFocus).toBeNull();
    });
});

describe('SELECT_NEXT_SCRIPT_FOLDER / SELECT_PREV_SCRIPT_FOLDER', () => {
    it('selects the first script when navigating to another page', () => {
        const state = buildMultiPageState(['alpha', 'beta']);
        const beta = state.scriptFolders.beta;
        const [extraId, extraData] = createEmptyScriptData(state.instance, state.connectionCatalog);
        const extraFile = '2_extra.sql';
        const withExtra: NotebookScripts = {
            ...state,
            scripts: {
                ...state.scripts,
                [extraId]: { ...extraData, folderName: 'beta', fileName: extraFile },
            },
            scriptFolders: {
                ...state.scriptFolders,
                beta: {
                    ...beta,
                    scripts: { ...beta.scripts, [extraFile]: createScriptRef(extraId, extraFile) },
                },
            },
        };
        const firstBetaFile = getSortedScriptFileNames(withExtra.scriptFolders.beta)[0];

        const next = reduce(withExtra, { type: SELECT_NEXT_SCRIPT_FOLDER, value: null });
        expect(next.scriptFocus).toMatchObject({ folderName: 'beta', fileName: firstBetaFile });

        const previous = reduce({
            ...next,
            scriptFocus: { ...next.scriptFocus, fileName: extraFile },
        }, { type: SELECT_PREV_SCRIPT_FOLDER, value: null });
        expect(previous.scriptFocus.fileName).toBe(getSortedScriptFileNames(previous.scriptFolders.alpha)[0]);
    });
});

// ---------------------------------------------------------------------------
// SELECT_NEXT_SCRIPT / SELECT_PREV_SCRIPT / SELECT_SCRIPT
// ---------------------------------------------------------------------------

describe('SELECT_NEXT_SCRIPT', () => {
    it('advances to the next entry by sorted file name', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_SCRIPT, value: null });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(s1)!);
        expect(files.length).toBe(2);
        // Move focus back to first entry, then advance.
        const s2 = reduce(
            { ...s1, scriptFocus: { ...s1.scriptFocus, fileName: files[0] } },
            { type: SELECT_NEXT_SCRIPT, value: null },
        );
        expect(s2.scriptFocus.fileName).toBe(files[1]);
    });

    it('is capped at the last entry', () => {
        const state = buildState(); // 1 committed entry
        const next = reduce(state, { type: SELECT_NEXT_SCRIPT, value: null });
        expect(next.scriptFocus.fileName).toBe(state.scriptFocus.fileName);
    });
});

describe('SELECT_PREV_SCRIPT', () => {
    it('moves to the previous entry by sorted file name', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_SCRIPT, value: null });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(s1)!);
        const s2 = reduce(
            { ...s1, scriptFocus: { ...s1.scriptFocus, fileName: files[1] } },
            { type: SELECT_PREV_SCRIPT, value: null },
        );
        expect(s2.scriptFocus.fileName).toBe(files[0]);
    });

    it('clamps at the first entry', () => {
        const state = buildState();
        const next = reduce(state, { type: SELECT_PREV_SCRIPT, value: null });
        expect(next.scriptFocus.fileName).toBe(state.scriptFocus.fileName);
    });
});

describe('SELECT_SCRIPT', () => {
    it('selects an entry by file name', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_SCRIPT, value: null });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(s1)!);
        const s2 = reduce(s1, { type: SELECT_SCRIPT, value: files[0] });
        expect(s2.scriptFocus.fileName).toBe(files[0]);
    });

    it('is a no-op for an unknown file name', () => {
        const state = buildState();
        const next = reduce(state, { type: SELECT_SCRIPT, value: 'nope.sql' });
        expect(next).toBe(state);
    });
});

describe('SELECT_SCRIPT_PATH', () => {
    it('selects an exact script path and requests a feed scroll', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_SCRIPT_FOLDER, value: null });
        const folderName = folderNames(s1)[0];
        const fileName = getSortedScriptFileNames(s1.scriptFolders[folderName])[0];
        const next = reduce(s1, { type: SELECT_SCRIPT_PATH, value: { folderName, fileName } });
        expect(next.scriptFocus).toEqual({ folderName, fileName, interactionCounter: s1.scriptFocus.interactionCounter + 1 });
    });

    it('is a no-op for a file outside the named folder', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_SCRIPT_FOLDER, value: null });
        const [firstFolder, secondFolder] = folderNames(s1);
        const secondFile = getSortedScriptFileNames(s1.scriptFolders[secondFolder])[0];
        const next = reduce(s1, { type: SELECT_SCRIPT_PATH, value: { folderName: firstFolder, fileName: secondFile } });
        expect(next).toBe(s1);
    });
});

// ---------------------------------------------------------------------------
// CREATE_SCRIPT_FOLDER
// ---------------------------------------------------------------------------

describe('CREATE_SCRIPT_FOLDER', () => {
    it('appends a new page without reallocating the notebook draft', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_SCRIPT_FOLDER, value: null });
        expect(folderNames(next).length).toBe(2);
        expect(next.uncommittedScriptId).toBe(state.uncommittedScriptId);
        expect(next.scripts[next.uncommittedScriptId]).toBeDefined();
    });

    it('moves focus to the new (prefixed) page', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_SCRIPT_FOLDER, value: null });
        expect(normalizeScriptFolderName(next.scriptFocus.folderName)).toBe('Untitled');
    });

    it('new page has an auto-created script', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_SCRIPT_FOLDER, value: null });
        const newPage = next.scriptFolders[next.scriptFocus.folderName];
        expect(Object.keys(newPage.scripts).length).toBe(1);
    });

    it('prefixes the new page and appends it fully to the right', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_SCRIPT_FOLDER, value: null });
        const sorted = getSortedScriptFolderNames(next.scriptFolders);
        // Both pages now carry a dense numeric prefix; the new "Untitled" sorts last.
        expect(sorted).toEqual(['1_Main', '2_Untitled']);
        expect(normalizeScriptFolderName(sorted[sorted.length - 1])).toBe('Untitled');
    });

    it('normalises still-unprefixed sibling pages on create', () => {
        // A notebook that mixes prefixed and prefix-free pages (as a freshly migrated example does).
        const state = buildMultiPageState(['1_main', '2_explain', 'vis_data', 'vis_spec']);
        const next = reduce(state, { type: CREATE_SCRIPT_FOLDER, value: null });
        const sorted = getSortedScriptFolderNames(next.scriptFolders);
        // Every page ends up prefixed, original order preserved, new page last.
        expect(sorted.map(normalizeScriptFolderName)).toEqual(['main', 'explain', 'vis_data', 'vis_spec', 'Untitled']);
        expect(sorted).toEqual(['1_main', '2_explain', '3_vis_data', '4_vis_spec', '5_Untitled']);
    });

    it('keeps adding new pages to the right across repeated creates', () => {
        let s = buildState();
        s = reduce(s, { type: CREATE_SCRIPT_FOLDER, value: null });
        s = reduce(s, { type: CREATE_SCRIPT_FOLDER, value: null });
        const sorted = getSortedScriptFolderNames(s.scriptFolders);
        expect(sorted.map(normalizeScriptFolderName)).toEqual(['Main', 'Untitled', 'Untitled 2']);
        expect(sorted).toEqual(['1_Main', '2_Untitled', '3_Untitled 2']);
    });
});

// ---------------------------------------------------------------------------
// CREATE_SCRIPT
// ---------------------------------------------------------------------------

describe('CREATE_SCRIPT', () => {
    it('appends a new entry to the selected page', () => {
        const state = buildState();
        const prevCount = pageEntryCount(state);
        const next = reduce(state, { type: CREATE_SCRIPT, value: null });
        expect(pageEntryCount(next)).toBe(prevCount + 1);
    });

    it('adds the corresponding script to the script map', () => {
        const state = buildState();
        const prevScriptCount = Object.keys(state.scripts).length;
        const next = reduce(state, { type: CREATE_SCRIPT, value: null });
        expect(Object.keys(next.scripts).length).toBe(prevScriptCount + 1);
    });

    it('moves focus to the newly created entry', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_SCRIPT, value: null });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(next)!);
        expect(files).toContain(next.scriptFocus.fileName);
        // The new entry is the last sorted file
        expect(files[files.length - 1]).toBe(next.scriptFocus.fileName);
    });

    it('new entry scriptId is present in the script map', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_SCRIPT, value: null });
        const page = getSelectedScriptFolder(next)!;
        const focusFile = next.scriptFocus.fileName;
        const newEntry = page.scripts[focusFile];
        expect(next.scripts[newEntry.scriptId]).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// DELETE_SCRIPT
// ---------------------------------------------------------------------------

describe('DELETE_SCRIPT', () => {
    it('removes the targeted entry', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_SCRIPT, value: null });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(s1)!);
        const next = reduce(s1, { type: DELETE_SCRIPT, value: files[0] });
        expect(pageEntryCount(next)).toBe(1);
        expect(getSelectedScriptFolder(next)!.scripts[files[0]]).toBeUndefined();
    });

    it('is a no-op when only one entry remains in the only page', () => {
        const state = buildState(); // 1 committed entry
        const file = state.scriptFocus.fileName;
        const next = reduce(state, { type: DELETE_SCRIPT, value: file });
        expect(pageEntryCount(next)).toBe(1);
    });

    it('is a no-op for an unknown file name', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_SCRIPT, value: null });
        const next = reduce(s1, { type: DELETE_SCRIPT, value: 'nope.sql' });
        expect(next).toBe(s1);
    });

    it('adjusts focus to the previous sorted entry when deleting the focused one', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_SCRIPT, value: null });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(s1)!);
        // Delete the second (focused) entry
        const s2 = reduce(s1, { type: DELETE_SCRIPT, value: files[1] });
        expect(s2.scriptFocus.fileName).toBe(files[0]);
    });

    it('removes dead scripts from the script map', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_SCRIPT, value: null });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(s1)!);
        const deletedFile = files[1];
        const deletedScriptId = getSelectedScriptFolder(s1)!.scripts[deletedFile].scriptId;
        expect(s1.scripts[deletedScriptId]).toBeDefined();
        const next = reduce(s1, { type: DELETE_SCRIPT, value: deletedFile });
        expect(next.scripts[deletedScriptId]).toBeUndefined();
    });

    it('preserves the notebook uncommitted script', () => {
        const state = buildState();
        const stateWithSecondEntry = reduce(state, { type: CREATE_SCRIPT, value: null });
        const uncommittedScriptId = stateWithSecondEntry.uncommittedScriptId;
        const files = getSortedScriptFileNames(getSelectedScriptFolder(stateWithSecondEntry)!);

        const next = reduce(stateWithSecondEntry, { type: DELETE_SCRIPT, value: files[1] });

        expect(next.uncommittedScriptId).toBe(uncommittedScriptId);
        expect(next.scripts[uncommittedScriptId]).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// RENAME_SCRIPT
// ---------------------------------------------------------------------------

describe('RENAME_SCRIPT', () => {
    it('renames the targeted entry, editing only the clean name and preserving the ordering prefix', () => {
        const state = buildState();
        const oldFile = state.scriptFocus.fileName; // "1_script.sql"
        // The rename input edits the clean display name; the reducer keeps the prefix and ".sql".
        const next = reduce(state, { type: RENAME_SCRIPT, value: { fileName: oldFile, newFileName: 'query' } });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(next)!);
        expect(files.map(scriptDisplayName)).toEqual(['query']);
        expect(getSelectedScriptFolder(next)!.scripts[oldFile]).toBeUndefined();
        // The ordering prefix is preserved across the rename.
        expect(scriptOrderPrefixString(files[0])).toBe(scriptOrderPrefixString(oldFile));
    });

    it('normalises a typed-in prefix/suffix down to the clean name', () => {
        const state = buildState();
        const oldFile = state.scriptFocus.fileName; // "1_script.sql"
        // Whatever prefix/extension the user types is stripped to the bare clean base.
        const next = reduce(state, { type: RENAME_SCRIPT, value: { fileName: oldFile, newFileName: '07-query.sql' } });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(next)!);
        expect(files.map(scriptDisplayName)).toEqual(['query']);
        // The script keeps ITS prefix, not the "07" the user typed.
        expect(scriptOrderPrefixString(files[0])).toBe(scriptOrderPrefixString(oldFile));
    });

    it('disambiguates a clean name that collides with another script', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_SCRIPT, value: null });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(s1)!);
        // Rename the first script to "shared", then rename the second to "shared" too.
        const s2 = reduce(s1, { type: RENAME_SCRIPT, value: { fileName: files[0], newFileName: 'shared' } });
        const files2 = getSortedScriptFileNames(getSelectedScriptFolder(s2)!);
        const s3 = reduce(s2, { type: RENAME_SCRIPT, value: { fileName: files2[1], newFileName: 'shared' } });
        const display = getSortedScriptFileNames(getSelectedScriptFolder(s3)!).map(scriptDisplayName);
        expect(display).toContain('shared');
        expect(display).toContain('shared-2');
        // The two scripts keep distinct clean names.
        expect(new Set(display).size).toBe(display.length);
    });

    it('ignores an empty (whitespace-only) clean name', () => {
        const state = buildState();
        const oldFile = state.scriptFocus.fileName;
        const next = reduce(state, { type: RENAME_SCRIPT, value: { fileName: oldFile, newFileName: '   ' } });
        expect(next).toBe(state);
    });

    it('is a no-op for an unknown file name', () => {
        const state = buildState();
        const next = reduce(state, { type: RENAME_SCRIPT, value: { fileName: 'nope.sql', newFileName: 'test.sql' } });
        expect(next).toBe(state);
    });

    it('does not mark outdated when fileName is unchanged', () => {
        const state = buildState();
        const file = state.scriptFocus.fileName;
        const scriptId = getSelectedScriptFolder(state)!.scripts[file].scriptId;

        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s1.scripts[scriptId].scriptAnalysis.outdated).toBe(false);

        const s2 = reduce(s1, { type: RENAME_SCRIPT, value: { fileName: file, newFileName: file } });
        expect(s2.scripts[scriptId].scriptAnalysis.outdated).toBe(false);
    });

});

describe('RENAME_SCRIPT_FOLDER', () => {
    it('renames the targeted page, assigning it an ordering prefix', () => {
        const state = buildState();
        const next = reduce(state, { type: RENAME_SCRIPT_FOLDER, value: { folderName: MAIN_FOLDER, newFolderName: 'Analytics' } });
        // The renamed page gains a numeric prefix (single page in a single-page notebook -> "1_").
        expect(next.scriptFolders['1_Analytics']).toBeDefined();
        expect(next.scriptFolders[MAIN_FOLDER]).toBeUndefined();
        expect(normalizeScriptFolderName(next.scriptFocus.folderName)).toBe('Analytics');
    });

    it('is a no-op for an unknown folder name', () => {
        const state = buildState();
        const next = reduce(state, { type: RENAME_SCRIPT_FOLDER, value: { folderName: 'Nope', newFolderName: 'Test' } });
        expect(next).toBe(state);
    });

    it('does not mark outdated when folderName is unchanged', () => {
        const state = buildState();
        const file = state.scriptFocus.fileName;
        const scriptId = getSelectedScriptFolder(state)!.scripts[file].scriptId;

        const s1 = reduce(state, { type: ANALYZE_OUTDATED_SCRIPT, value: scriptId });
        expect(s1.scripts[scriptId].scriptAnalysis.outdated).toBe(false);

        const s2 = reduce(s1, { type: RENAME_SCRIPT_FOLDER, value: { folderName: MAIN_FOLDER, newFolderName: MAIN_FOLDER } });
        expect(s2.scripts[scriptId].scriptAnalysis.outdated).toBe(false);
    });

});

// ---------------------------------------------------------------------------
// Page ordering prefix helpers
// ---------------------------------------------------------------------------

describe('page order prefix helpers', () => {
    it('normalizeScriptFolderName removes a leading <digits>_ prefix', () => {
        expect(normalizeScriptFolderName('03_main')).toBe('main');
        expect(normalizeScriptFolderName('1_vis_data')).toBe('vis_data');
        expect(normalizeScriptFolderName('main')).toBe('main');
        expect(normalizeScriptFolderName('Untitled 2')).toBe('Untitled 2');
    });

    it('scriptFolderOrderPrefixString returns the prefix including the underscore, else empty', () => {
        expect(scriptFolderOrderPrefixString('03_main')).toBe('03_');
        expect(scriptFolderOrderPrefixString('main')).toBe('');
    });

    it('formatScriptFolderOrderPrefix pads only to the digits the total requires', () => {
        expect(formatScriptFolderOrderPrefix(1, 9)).toBe('1_');
        expect(formatScriptFolderOrderPrefix(1, 10)).toBe('01_');
        expect(formatScriptFolderOrderPrefix(12, 12)).toBe('12_');
        expect(formatScriptFolderOrderPrefix(7, 100)).toBe('007_');
    });
});

// ---------------------------------------------------------------------------
// REORDER_SCRIPT_FOLDERS
// ---------------------------------------------------------------------------

// Builds a state with several named pages, each holding one script seeded with SQL.
function buildMultiPageState(folderNames: string[]): NotebookScripts {
    const state = buildState();
    // Drop the default 'Main' page; rebuild pages from the requested names.
    const pages: NotebookScripts['scriptFolders'] = {};
    const scripts: NotebookScripts['scripts'] = {
        [state.uncommittedScriptId]: state.scripts[state.uncommittedScriptId],
    };
    let firstFolder = '';
    let firstFile = '';
    for (const folderName of folderNames) {
        const [key, data] = createEmptyScriptData(state.instance, state.connectionCatalog);
        const fileName = generateScriptFileName({});
        data.script.insertTextAt(0, 'SELECT 1 as x');
        scripts[key] = { ...data, folderName, fileName };
        pages[folderName] = { folderName, scripts: { [fileName]: createScriptRef(key, fileName) } };
        if (firstFolder === '') { firstFolder = folderName; firstFile = fileName; }
    }
    return {
        ...state,
        scripts,
        scriptFolders: pages,
        scriptFocus: { folderName: firstFolder, fileName: firstFile, interactionCounter: 0 },
    };
}

describe('REORDER_SCRIPT_FOLDERS', () => {
    it('assigns dense ordering prefixes that sort to the requested order', () => {
        const state = buildMultiPageState(['alpha', 'beta', 'gamma']);
        // Default lexicographic order is alpha, beta, gamma. Request gamma, alpha, beta.
        const next = reduce(state, { type: REORDER_SCRIPT_FOLDERS, value: ['gamma', 'alpha', 'beta'] });
        const sorted = getSortedScriptFolderNames(next.scriptFolders);
        expect(sorted.map(normalizeScriptFolderName)).toEqual(['gamma', 'alpha', 'beta']);
        // Prefixes are dense and single-digit for a 3-page notebook.
        expect(sorted).toEqual(['1_gamma', '2_alpha', '3_beta']);
    });

    it('is a no-op when the requested order matches the current order', () => {
        const state = buildMultiPageState(['alpha', 'beta', 'gamma']);
        const next = reduce(state, { type: REORDER_SCRIPT_FOLDERS, value: ['alpha', 'beta', 'gamma'] });
        expect(next).toBe(state);
    });

    it('appends omitted pages after the requested ones without dropping any', () => {
        const state = buildMultiPageState(['alpha', 'beta', 'gamma']);
        const next = reduce(state, { type: REORDER_SCRIPT_FOLDERS, value: ['gamma'] });
        const sorted = getSortedScriptFolderNames(next.scriptFolders);
        expect(sorted.map(normalizeScriptFolderName)).toEqual(['gamma', 'alpha', 'beta']);
    });

    it('moves focus to the renamed folder of the previously focused page', () => {
        const state = buildMultiPageState(['alpha', 'beta', 'gamma']);
        const s1 = reduce(state, { type: SELECT_SCRIPT_FOLDER, value: 'beta' });
        expect(s1.scriptFocus.folderName).toBe('beta');
        const s2 = reduce(s1, { type: REORDER_SCRIPT_FOLDERS, value: ['gamma', 'beta', 'alpha'] });
        expect(normalizeScriptFolderName(s2.scriptFocus.folderName)).toBe('beta');
        expect(s2.scriptFolders[s2.scriptFocus.folderName]).toBeDefined();
    });

    it('re-densifies prefixes on a notebook that already has them', () => {
        const state = buildMultiPageState(['1_alpha', '2_beta', '3_gamma']);
        const next = reduce(state, { type: REORDER_SCRIPT_FOLDERS, value: ['3_gamma', '1_alpha', '2_beta'] });
        expect(getSortedScriptFolderNames(next.scriptFolders)).toEqual(['1_gamma', '2_alpha', '3_beta']);
    });
});

describe('RENAME_SCRIPT_FOLDER keeps the page in its slot', () => {
    it('retains the page position (re-deriving the prefix) on rename', () => {
        const state = buildMultiPageState(['1_alpha', '2_beta']);
        const next = reduce(state, { type: RENAME_SCRIPT_FOLDER, value: { folderName: '2_beta', newFolderName: 'reports' } });
        expect(next.scriptFolders['2_reports']).toBeDefined();
        expect(next.scriptFolders['2_beta']).toBeUndefined();
        // Order is unchanged: alpha still before the renamed page.
        expect(getSortedScriptFolderNames(next.scriptFolders).map(normalizeScriptFolderName)).toEqual(['alpha', 'reports']);
    });

    it('assigns a prefix when renaming a page that had none, keeping its slot', () => {
        // Mixed notebook: a prefix-free page sitting after a prefixed one.
        const state = buildMultiPageState(['1_alpha', 'zebra']);
        const next = reduce(state, { type: RENAME_SCRIPT_FOLDER, value: { folderName: 'zebra', newFolderName: 'reports' } });
        // 'zebra' is in slot 2 of the view order, so it becomes '2_reports'.
        expect(next.scriptFolders['2_reports']).toBeDefined();
        expect(next.scriptFolders['zebra']).toBeUndefined();
        expect(getSortedScriptFolderNames(next.scriptFolders)).toEqual(['1_alpha', '2_reports']);
    });

    it('normalises still-unprefixed sibling pages on rename', () => {
        const state = buildMultiPageState(['1_main', '2_explain', 'vis_data', 'vis_spec']);
        // Rename the first page; the trailing prefix-free pages must be normalised too.
        const next = reduce(state, { type: RENAME_SCRIPT_FOLDER, value: { folderName: '1_main', newFolderName: 'overview' } });
        expect(getSortedScriptFolderNames(next.scriptFolders)).toEqual(['1_overview', '2_explain', '3_vis_data', '4_vis_spec']);
    });

    it('is a no-op when the clean name is unchanged', () => {
        const state = buildMultiPageState(['1_alpha', '2_beta']);
        const next = reduce(state, { type: RENAME_SCRIPT_FOLDER, value: { folderName: '2_beta', newFolderName: 'beta' } });
        expect(next).toBe(state);
    });
});

// ---------------------------------------------------------------------------
// Rename persistence plan: structural renames move files in place rather than
// delete-old + recreate-new. Asserted via the RecordingStorageWriter.
// ---------------------------------------------------------------------------

describe('rename persistence plan', () => {
    function record(state: NotebookScripts, action: Parameters<typeof reduceNotebookScripts>[1]) {
        const recorder = new RecordingStorageWriter(logger, backend);
        const next = reduceNotebookScripts(state, action, recorder, logger, true);
        return { next, records: recorder.records };
    }

    it('RENAME_SCRIPT_FOLDER renames the folder in place (no delete/recreate of the page)', () => {
        const state = buildMultiPageState(['1_alpha', '2_beta']);
        const { records } = record(state, { type: RENAME_SCRIPT_FOLDER, value: { folderName: '2_beta', newFolderName: 'reports' } });

        const renames = records.filter(r => r.task.type === STORAGE_RENAME_SCRIPT_FOLDER).map(r => r.task.value);
        expect(renames).toEqual([[state.notebookId, '2_beta', '2_reports']]);
        // The renamed page is moved, not torn down and rebuilt.
        expect(records.some(r => r.task.type === STORAGE_DELETE_SCRIPT_FOLDER)).toBe(false);
        expect(records.some(r => r.task.type === STORAGE_CREATE_SCRIPT_FOLDER)).toBe(false);
    });

    it('REORDER_SCRIPT_FOLDERS renames each moved folder in place', () => {
        const state = buildMultiPageState(['1_alpha', '2_beta', '3_gamma']);
        const { records } = record(state, { type: REORDER_SCRIPT_FOLDERS, value: ['3_gamma', '1_alpha', '2_beta'] });

        const renames = records.filter(r => r.task.type === STORAGE_RENAME_SCRIPT_FOLDER).map(r => r.task.value);
        // gamma->slot1, alpha->slot2, beta->slot3. The clean names are held stable.
        expect(renames).toEqual([
            [state.notebookId, '3_gamma', '1_gamma'],
            [state.notebookId, '1_alpha', '2_alpha'],
            [state.notebookId, '2_beta', '3_beta'],
        ]);
        expect(records.some(r => r.task.type === STORAGE_DELETE_SCRIPT_FOLDER)).toBe(false);
    });

    it('CREATE_SCRIPT_FOLDER creates the new page but only renames the pre-existing siblings it reprefixes', () => {
        // Two prefix-free siblings force a reprefix; the brand-new page has nothing on disk yet.
        const state = buildMultiPageState(['alpha', 'beta']);
        const { records } = record(state, { type: CREATE_SCRIPT_FOLDER, value: null });

        const created = records.filter(r => r.task.type === STORAGE_CREATE_SCRIPT_FOLDER).map(r => (r.task.value as any[])[1]);
        const renamed = records.filter(r => r.task.type === STORAGE_RENAME_SCRIPT_FOLDER).map(r => r.task.value);
        // The freshly created (never-flushed) page is written via CREATE, landing last (slot 3).
        expect(created).toEqual(['3_Untitled']);
        // The two persisted siblings are moved in place to gain their prefixes.
        expect(renamed).toEqual([
            [state.notebookId, 'alpha', '1_alpha'],
            [state.notebookId, 'beta', '2_beta'],
        ]);
    });

    it('RENAME_SCRIPT renames the script file in place (no delete + rewrite)', () => {
        const state = buildState();
        const oldFile = Object.keys(getSelectedScriptFolder(state)!.scripts)[0];
        const { next, records } = record(state, { type: RENAME_SCRIPT, value: { fileName: oldFile, newFileName: 'renamed' } });

        const newFile = getSortedScriptFileNames(getSelectedScriptFolder(next)!)[0];
        expect(newFile).not.toBe(oldFile);
        const renames = records.filter(r => r.task.type === STORAGE_RENAME_SCRIPT).map(r => r.task.value);
        expect(renames).toEqual([[state.notebookId, MAIN_FOLDER, oldFile, newFile]]);
        // No delete of the old file and no content rewrite of either name.
        expect(records.some(r => r.task.type === STORAGE_DELETE_SCRIPT)).toBe(false);
        expect(records.some(r => r.task.type === WRITE_SCRIPT)).toBe(false);
    });

    it('RENAME_SCRIPT without a name change writes content under the unchanged name', () => {
        const state = buildState();
        const file = Object.keys(getSelectedScriptFolder(state)!.scripts)[0];
        // Re-submitting the current display name is not a rename.
        const { records } = record(state, { type: RENAME_SCRIPT, value: { fileName: file, newFileName: scriptDisplayName(file) } });
        expect(records.some(r => r.task.type === STORAGE_RENAME_SCRIPT)).toBe(false);
        const written = records.filter(r => r.task.type === WRITE_SCRIPT).map(r => (r.task.value as string[])[2]);
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
        const scripts: { [fileName: string]: ScriptRef } = {
            '1_script.sql': createScriptRef(1, '1_script.sql'),
            '2_extract.sql': createScriptRef(2, '2_extract.sql'),
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
    function scriptsFromNames(names: string[]): { [fileName: string]: ScriptRef } {
        const map: { [fileName: string]: ScriptRef } = {};
        names.forEach((name, i) => { map[name] = createScriptRef(i + 1, name); });
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
// REORDER_SCRIPTS
// ---------------------------------------------------------------------------

// Builds a single 'Main' page holding scripts at the given file names, each seeded with SQL.
function buildScriptState(fileNames: string[]): NotebookScripts {
    const state = buildState();
    const scripts: NotebookScripts['scripts'] = {
        [state.uncommittedScriptId]: state.scripts[state.uncommittedScriptId],
    };
    const pageScripts: { [fileName: string]: ScriptRef } = {};
    for (const fileName of fileNames) {
        const [key, data] = createEmptyScriptData(state.instance, state.connectionCatalog);
        data.script.insertTextAt(0, 'SELECT 1 as x');
        scripts[key] = { ...data, folderName: MAIN_FOLDER, fileName };
        pageScripts[fileName] = createScriptRef(key, fileName);
    }
    return {
        ...state,
        scripts,
        scriptFolders: { [MAIN_FOLDER]: { folderName: MAIN_FOLDER, scripts: pageScripts } },
        scriptFocus: { folderName: MAIN_FOLDER, fileName: fileNames[0] ?? '', interactionCounter: 0 },
    };
}

describe('REORDER_SCRIPTS', () => {
    it('is scoped to the named folder rather than the selected folder', () => {
        const selected = buildScriptState(['1_a.sql', '2_b.sql']);
        const otherFolder = 'Other';
        const [firstId, firstData] = createEmptyScriptData(selected.instance, selected.connectionCatalog);
        const [secondId, secondData] = createEmptyScriptData(selected.instance, selected.connectionCatalog);
        const state: NotebookScripts = {
            ...selected,
            scripts: {
                ...selected.scripts,
                [firstId]: { ...firstData, folderName: otherFolder, fileName: '1_x.sql' },
                [secondId]: { ...secondData, folderName: otherFolder, fileName: '2_y.sql' },
            },
            scriptFolders: {
                ...selected.scriptFolders,
                [otherFolder]: {
                    folderName: otherFolder,
                    scripts: {
                        '1_x.sql': createScriptRef(firstId, '1_x.sql'),
                        '2_y.sql': createScriptRef(secondId, '2_y.sql'),
                    },
                },
            },
        };

        const next = reduce(state, {
            type: REORDER_SCRIPTS,
            value: { folderName: otherFolder, fileNames: ['2_y.sql', '1_x.sql'] },
        });
        expect(getSortedScriptFileNames(next.scriptFolders[otherFolder]).map(scriptDisplayName)).toEqual(['y', 'x']);
        expect(getSortedScriptFileNames(next.scriptFolders[MAIN_FOLDER])).toEqual(['1_a.sql', '2_b.sql']);
        expect(next.scriptFocus).toEqual(state.scriptFocus);
    });

    it('assigns dense ordering prefixes that sort to the requested order', () => {
        const state = buildScriptState(['1_a.sql', '2_b.sql', '3_c.sql']);
        const next = reduce(state, { type: REORDER_SCRIPTS, value: { folderName: MAIN_FOLDER, fileNames: ['3_c.sql', '1_a.sql', '2_b.sql'] } });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(next)!);
        expect(files).toEqual(['1_c.sql', '2_a.sql', '3_b.sql']);
        expect(files.map(scriptDisplayName)).toEqual(['c', 'a', 'b']);
    });

    it('is a no-op when the requested order matches the current feed order', () => {
        const state = buildScriptState(['1_a.sql', '2_b.sql', '3_c.sql']);
        const next = reduce(state, { type: REORDER_SCRIPTS, value: { folderName: MAIN_FOLDER, fileNames: ['1_a.sql', '2_b.sql', '3_c.sql'] } });
        expect(next).toBe(state);
    });

    it('appends omitted files after the requested ones without dropping any', () => {
        const state = buildScriptState(['1_a.sql', '2_b.sql', '3_c.sql']);
        const next = reduce(state, { type: REORDER_SCRIPTS, value: { folderName: MAIN_FOLDER, fileNames: ['3_c.sql'] } });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(next)!);
        expect(files.map(scriptDisplayName)).toEqual(['c', 'a', 'b']);
    });

    it('follows the focused file across its rename', () => {
        const state = buildScriptState(['1_a.sql', '2_b.sql', '3_c.sql']);
        const s1 = reduce(state, { type: SELECT_SCRIPT, value: '3_c.sql' });
        expect(s1.scriptFocus.fileName).toBe('3_c.sql');
        const s2 = reduce(s1, { type: REORDER_SCRIPTS, value: { folderName: MAIN_FOLDER, fileNames: ['3_c.sql', '1_a.sql', '2_b.sql'] } });
        expect(scriptDisplayName(s2.scriptFocus.fileName)).toBe('c');
        expect(getSelectedScriptFolder(s2)!.scripts[s2.scriptFocus.fileName]).toBeDefined();
    });

    it('normalises legacy hyphen-separated names to the "_" form on reorder', () => {
        const state = buildScriptState(['01-a.sql', '02-b.sql']);
        const next = reduce(state, { type: REORDER_SCRIPTS, value: { folderName: MAIN_FOLDER, fileNames: ['02-b.sql', '01-a.sql'] } });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(next)!);
        expect(files).toEqual(['1_b.sql', '2_a.sql']);
    });

    it('is a no-op when there is no selected page', () => {
        const state = buildScriptState(['1_a.sql']);
        const headless: NotebookScripts = { ...state, scriptFolders: {}, scriptFocus: { folderName: '', fileName: '', interactionCounter: 0 } };
        const next = reduce(headless, { type: REORDER_SCRIPTS, value: { folderName: MAIN_FOLDER, fileNames: ['1_a.sql'] } });
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
        const next = reduceNotebookScripts(
            state,
            { type: REORDER_SCRIPTS, value: { folderName: MAIN_FOLDER, fileNames: ['2_script.sql', '1_script.sql'] } },
            recorder,
            logger,
            true,
        );

        // In-memory order is swapped and both clean names are preserved.
        const files = getSortedScriptFileNames(getSelectedScriptFolder(next)!);
        expect(files).toEqual(['1_script.sql', '2_script.sql']);
        expect(files.map(scriptDisplayName)).toEqual(['script', 'script']);

        const written = new Set(
            recorder.records.filter(r => r.task.type === WRITE_SCRIPT).map(r => (r.task.value as string[])[2]),
        );
        const deleted = new Set(
            recorder.records.filter(r => r.task.type === STORAGE_DELETE_SCRIPT).map(r => (r.task.value as string[])[2]),
        );
        // Both paths are (re)written, and neither is deleted — no write can be shadowed by a delete.
        expect([...written].sort()).toEqual(['1_script.sql', '2_script.sql']);
        for (const path of written) {
            expect(deleted.has(path)).toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// CREATE_SCRIPT appends at the bottom with re-pad
// ---------------------------------------------------------------------------

describe('CREATE_SCRIPT ordering', () => {
    it('adds the new script at the bottom of the feed', () => {
        const state = buildScriptState(['1_a.sql', '2_b.sql']);
        const next = reduce(state, { type: CREATE_SCRIPT, value: null });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(next)!);
        expect(files[files.length - 1]).toBe(next.scriptFocus.fileName);
        // The new bottom script sorts after the existing two.
        expect(files.map(scriptDisplayName).slice(0, 2)).toEqual(['a', 'b']);
    });

    it('re-pads existing scripts to a uniform width when the 10th script is added', () => {
        const names = Array.from({ length: 9 }, (_, i) => `${i + 1}_s${i + 1}.sql`);
        const state = buildScriptState(names);
        const next = reduce(state, { type: CREATE_SCRIPT, value: null });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(next)!);
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
// PROMOTE_UNCOMMITTED_SCRIPT
// ---------------------------------------------------------------------------

describe('PROMOTE_UNCOMMITTED_SCRIPT', () => {
    it('appends the uncommitted script as a new committed entry', () => {
        const state = buildState();
        const prevUncommittedId = state.uncommittedScriptId;
        const prevEntryCount = pageEntryCount(state);
        const next = reduce(state, { type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
        expect(pageEntryCount(next)).toBe(prevEntryCount + 1);
        const focusFile = next.scriptFocus.fileName;
        const promotedEntry = getSelectedScriptFolder(next)!.scripts[focusFile];
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
        const files = getSortedScriptFileNames(getSelectedScriptFolder(next)!);
        expect(next.scriptFocus.fileName).toBe(files[files.length - 1]);
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
// compileQuery
// ---------------------------------------------------------------------------

describe('compileQuery', () => {
    const VISUALIZE_SCRIPT =
        'select v as a from generate_series(1, 10) t(v) |> visualize using vegalite ( mark => bar, encoding => ( x => (field => a) ) )';

    it('extracts the inner SELECT from a VISUALIZE script even when analysis is still outdated', () => {
        // Reproduces the first-run race: the script was just inserted and not
        // analyzed yet, so annotations.visualizeQuery is null. We must still
        // send the source SELECT to the backend, not the full visualization pipeline.
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const scriptData = state.scripts[scriptKey];
        scriptData.script.insertTextAt(0, VISUALIZE_SCRIPT);

        expect(scriptData.scriptAnalysis.outdated).toBe(true);
        expect(scriptData.annotations.visualizeQuery).toBeNull();

        const text = compileQuery(scriptData);
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

        const text = compileQuery(scriptData);
        expect(text.toLowerCase()).not.toContain('visualize');
        expect(text.toLowerCase()).toContain('select v as a');
    });

    it('lowers a relational pipe source before visualization execution', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const script = `from sales
            |> where amount > 0
            |> visualize using umap (
                vector => embedding,
                metric => euclidean,
                neighbors => 15,
                min_dist => 0.1
            )`;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: script } });

        const query = next.scripts[scriptKey].annotations.visualizeQuery;
        expect(query?.renderer).toBe('umap');
        expect(query?.sql.toLowerCase()).not.toContain('|>');
        expect(query?.sql.toLowerCase()).toContain('select * from');
        expect(query?.sql.toLowerCase()).toContain('where amount > 0');
    });

    it('logs pipe and lowered SQL for visualization execution', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const script = `from sales |> where amount > 0 |> visualize using umap (
            vector => embedding,
            metric => euclidean,
            neighbors => 15,
            min_dist => 0.1
        )`;
        const debug = vi.spyOn(logger, 'debug');

        reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: script } });

        expect(debug).toHaveBeenCalledWith('Compiled visualization for execution', {
            sql: expect.stringContaining('where amount > 0'),
        }, 'notebook_scripts');
        debug.mockRestore();
    });

    it('extracts the inner SELECT when a comment precedes VISUALIZE', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const script = `-- chart context\n${VISUALIZE_SCRIPT}`;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: script } });

        const text = compileQuery(next.scripts[scriptKey]);
        expect(text).toBe('select v as a from generate_series(1, 10) t(v)');
    });

    it('strips SQL quotes from a nested Vega-Lite axis title', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const script = `select 1 as metric |> visualize using vegalite (
            mark => bar,
            encoding => (y => (
                field => metric,
                type => quantitative,
                axis => (title => 'cpu_time')
            ))
        )`;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: script } });
        const raw = next.scripts[scriptKey].annotations.visualizeQuery?.renderer === 'vegalite'
            ? next.scripts[scriptKey].annotations.visualizeQuery.vegaLiteSpec as any
            : null;

        expect(raw?.encoding?.y).toMatchObject({ axis: { title: 'cpu_time' } });
    });

    it('returns the raw script text for a plain SQL statement', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const scriptData = state.scripts[scriptKey];
        scriptData.script.insertTextAt(0, 'SELECT 1 as x');

        const text = compileQuery(scriptData);
        expect(text).toBe('SELECT 1 as x');
    });

    it('lowers an ordinary relational pipe before execution', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const script = `from sales |> where amount > 0 |> select category, amount`;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: script } });

        const text = compileQuery(next.scripts[scriptKey]);
        expect(text.toLowerCase()).not.toContain('|>');
        expect(text.toLowerCase()).toContain('select category, amount');
        expect(text.toLowerCase()).toContain('where amount > 0');
    });

    it('lowers a table-function relational pipe without executing a function argument', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const script = `from generate_series(1, 100) t(v) |> select v as x, random() as y`;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: script } });

        expect(compileQuery(next.scripts[scriptKey])).toBe(
            'select v as x, random() as y from (select * from generate_series(1, 100) t(v)) as _dashql_pipe'
        );
    });

    it('compiles preceding terminal pipe aliases into local CTEs and executes the final statement', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const script = `from sales |> aggregate sum(amount) as total |> as table1;
            from refunds |> aggregate sum(amount) as total |> as table2;
            from table1 |> union all (from table2) |> order by total`;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: script } });

        const text = compileQuery(next.scripts[scriptKey]);
        expect(text.toLowerCase()).toContain('with table1 as');
        expect(text.toLowerCase()).toContain('table2 as');
        expect(text.toLowerCase()).toContain('union all');
        expect(text).not.toContain('|>');
    });

    it('folds preceding pipe aliases into an explained final statement', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const script = `from external('/tmp/part.parquet', format => 'parquet') |> as part;
            from external('/tmp/supplier.parquet', format => 'parquet') |> as supplier;
            explain (analyze, format internal) select * from supplier, part`;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: script } });

        const text = compileQuery(next.scripts[scriptKey]);
        expect(text.toLowerCase()).toMatch(/^explain \(analyze, format internal\) with part as/);
        expect(text.toLowerCase()).toContain('supplier as');
        expect(text.toLowerCase()).toContain('select * from supplier, part');
        expect(text).not.toContain('|>');
    });

    it('preserves plain multi-statement SQL verbatim', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const next = reduce(state, {
            type: SET_SCRIPT_TEXT,
            value: { scriptKey, text: 'select 1; select 2' },
        });

        expect(compileQuery(next.scripts[scriptKey])).toBe('select 1; select 2');
    });

    it('does not treat a pipe operator inside a string as relational syntax', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const script = `select '|>' as operator_text`;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: script } });

        expect(compileQuery(next.scripts[scriptKey])).toBe(script);
    });

    it('returns executable relational-pipe SQL without a trailing semicolon', () => {
        const state = buildState();
        state.connectorInfo = CONNECTOR_INFOS[ConnectorType.TRINO];
        const scriptKey = +Object.keys(state.scripts)[0];
        const script = `from sales |> where amount > 0 |> select category, amount`;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: script } });

        const text = compileQuery(next.scripts[scriptKey]);
        expect(text.toLowerCase()).not.toContain('|>');
        expect(text.trimEnd().endsWith(';')).toBe(false);
    });

    it('preserves plain Trino SQL verbatim', () => {
        const state = buildState();
        state.connectorInfo = CONNECTOR_INFOS[ConnectorType.TRINO];
        const scriptKey = +Object.keys(state.scripts)[0];
        const script = 'SELECT 1; -- context';
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: script } });

        expect(compileQuery(next.scripts[scriptKey])).toBe(script);
    });

    it('logs the pipe and lowered SQL when preparing execution', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const script = `from sales |> where amount > 0 |> select category, amount`;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: script } });
        const debug = vi.spyOn(logger, 'debug');

        const sql = compileQuery(next.scripts[scriptKey], logger);

        expect(debug).toHaveBeenCalledWith('Compiled script for query execution', {
            sql,
        }, 'notebook_scripts');
        debug.mockRestore();
    });

});

// ---------------------------------------------------------------------------
// analyzeAllScripts / getScriptKeysInFeedOrder
// ---------------------------------------------------------------------------

describe('getScriptKeysInFeedOrder', () => {
    it('orders pages top-down (sorted folders, sorted files) then the uncommitted script', () => {
        // buildState gives one Main page with one entry + an uncommitted script.
        // Add a second page and a second entry on Main to exercise the ordering.
        let state = buildState();
        const mainFile = state.scriptFocus.fileName;
        state = reduce(state, { type: CREATE_SCRIPT, value: null }); // 2nd entry on Main
        state = reduce(state, { type: CREATE_SCRIPT_FOLDER, value: null }); // 'Untitled' page + auto script

        const order = getScriptKeysInFeedOrder(state);

        // Build the expected order independently from the page maps.
        const expected: number[] = [];
        for (const folder of getSortedScriptFolderNames(state.scriptFolders)) {
            const page = state.scriptFolders[folder];
            for (const file of getSortedScriptFileNames(page)) {
                expected.push(page.scripts[file].scriptId);
            }
        }
        expected.push(state.uncommittedScriptId);

        expect(order).toEqual(expected);
        // 'Main' sorts before 'Untitled', so the original Main entry comes first. CREATE_SCRIPT_FOLDER
        // re-prefixed the page ('Main' -> '1_Main'), so resolve it under its current name.
        const mainFolder = getSortedScriptFolderNames(state.scriptFolders)[0];
        const mainFirstScriptId = state.scriptFolders[mainFolder].scripts[mainFile].scriptId;
        expect(order[0]).toBe(mainFirstScriptId);
        // The uncommitted composer script is always last.
        expect(order[order.length - 1]).toBe(state.uncommittedScriptId);
    });

    it('has no duplicates and covers every script', () => {
        let state = buildState();
        state = reduce(state, { type: CREATE_SCRIPT, value: null });
        const order = getScriptKeysInFeedOrder(state);
        expect(new Set(order).size).toBe(order.length);
        expect(new Set(order)).toEqual(new Set(Object.keys(state.scripts).map(Number)));
    });
});

describe('analyzeAllScripts', () => {
    it('analyzes every script in a single pass and reports per-script progress', () => {
        let state = buildState();
        state = reduce(state, { type: CREATE_SCRIPT, value: null });
        // Seed real SQL so analysis produces non-null buffers.
        for (const key of Object.keys(state.scripts)) {
            state.scripts[+key].script.replaceText('SELECT 1 as x');
        }

        const counts: boolean[] = [];
        let reportedTotal = -1;
        const next = analyzeAllScripts(state, logger, {
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
// REGISTER_AGENT_RUN
// ---------------------------------------------------------------------------

describe('REGISTER_AGENT_RUN', () => {
    it('records latestAgentRunId on the referenced script', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const next = reduce(state, { type: REGISTER_AGENT_RUN, value: [scriptKey, 77] });
        expect(next.scripts[scriptKey].latestAgentRunId).toBe(77);
    });

    it('leaves latestQueryId untouched', () => {
        const state = buildState();
        const scriptKey = +Object.keys(state.scripts)[0];
        const withQuery = reduce(state, { type: REGISTER_QUERY, value: [scriptKey, 42] });
        const next = reduce(withQuery, { type: REGISTER_AGENT_RUN, value: [scriptKey, 77] });
        expect(next.scripts[scriptKey].latestQueryId).toBe(42);
        expect(next.scripts[scriptKey].latestAgentRunId).toBe(77);
    });

    it('returns the unchanged state for an unknown scriptKey', () => {
        const state = buildState();
        const next = reduce(state, { type: REGISTER_AGENT_RUN, value: [99999, 1] });
        expect(next).toBe(state);
    });
});

// ---------------------------------------------------------------------------
// SET_SCRIPT_TEXT
// ---------------------------------------------------------------------------

describe('SET_SCRIPT_TEXT', () => {
    it('rewrites the script text in-place', () => {
        const state = buildState();
        const scriptKey = getSelectedScriptFolder(state)!.scripts[state.scriptFocus.fileName].scriptId;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: 'SELECT 1 as x' } });
        expect(next.scripts[scriptKey].script.toString()).toBe('SELECT 1 as x');
    });

    it('re-analyzes the rewritten script', () => {
        const state = buildState();
        const scriptKey = getSelectedScriptFolder(state)!.scripts[state.scriptFocus.fileName].scriptId;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: 'SELECT 1 as x, 2 as y' } });
        expect(next.scripts[scriptKey].scriptAnalysis.outdated).toBe(false);
        expect(next.scripts[scriptKey].scriptAnalysis.buffers.analyzed).not.toBeNull();
    });

    it('refreshes the resolved VISUALIZE annotation', () => {
        const state = buildState();
        const scriptKey = getSelectedScriptFolder(state)!.scripts[state.scriptFocus.fileName].scriptId;
        const visualize =
            'select v as a from generate_series(1, 10) t(v) |> visualize using vegalite ( mark => bar, encoding => ( x => (field => a) ) )';
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: visualize } });
        expect(next.scripts[scriptKey].annotations.visualizeQuery).not.toBeNull();
        expect(next.scripts[scriptKey].annotations.visualizeQuery!.sql.toLowerCase()).toContain('select v as a');
    });

    it('marks other scripts outdated', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_SCRIPT, value: null });
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

    it('stages a pending diff when withDiff is set and the text changes', () => {
        const state = buildState();
        const scriptKey = getSelectedScriptFolder(state)!.scripts[state.scriptFocus.fileName].scriptId;
        const next = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: 'SELECT 1 as x', withDiff: true } });
        expect(next.scripts[scriptKey].pendingDiff).not.toBeNull();
        expect(next.scripts[scriptKey].pendingDiff!.priorText).toBe('');
        expect(next.scripts[scriptKey].script.toString()).toBe('SELECT 1 as x');
    });
});

// ---------------------------------------------------------------------------
// ACCEPT_PENDING_DIFF / REJECT_PENDING_DIFF
// ---------------------------------------------------------------------------

describe('ACCEPT_PENDING_DIFF / REJECT_PENDING_DIFF', () => {
    /// Stage a real pending diff on the focused script (mirrors an applied agent rewrite) and
    /// return [state, scriptKey]. Uses SET_SCRIPT_TEXT with withDiff so the diff buffer is genuine.
    function stagePendingDiff(priorText: string, newText: string): [NotebookScripts, number] {
        let state = buildState();
        const scriptKey = getSelectedScriptFolder(state)!.scripts[state.scriptFocus.fileName].scriptId;
        // Seed the prior text first (no diff), then apply the rewrite with a staged diff.
        if (priorText !== '') {
            state = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: priorText } });
        }
        state = reduce(state, { type: SET_SCRIPT_TEXT, value: { scriptKey, text: newText, withDiff: true } });
        expect(state.scripts[scriptKey].pendingDiff).not.toBeNull();
        return [state, scriptKey];
    }

    it('ACCEPT keeps the new text and clears the pending diff', () => {
        const [staged, scriptKey] = stagePendingDiff('SELECT 1 as a', 'SELECT 2 as b');
        const next = reduce(staged, { type: ACCEPT_PENDING_DIFF, value: scriptKey });
        expect(next.scripts[scriptKey].pendingDiff).toBeNull();
        // Accept keeps the applied (new) text — no rope change.
        expect(next.scripts[scriptKey].script.toString()).toBe('SELECT 2 as b');
    });

    it('ACCEPT frees the staged diff buffer', () => {
        const [staged, scriptKey] = stagePendingDiff('SELECT 1 as a', 'SELECT 2 as b');
        const destroySpy = vi.spyOn(staged.scripts[scriptKey].pendingDiff!.diffBuffer, 'destroy');
        reduce(staged, { type: ACCEPT_PENDING_DIFF, value: scriptKey });
        expect(destroySpy).toHaveBeenCalledTimes(1);
    });

    it('REJECT restores the prior text, re-analyzes, and clears the pending diff', () => {
        const [staged, scriptKey] = stagePendingDiff('SELECT 1 as a', 'SELECT 2 as b');
        const next = reduce(staged, { type: REJECT_PENDING_DIFF, value: scriptKey });
        expect(next.scripts[scriptKey].pendingDiff).toBeNull();
        // Reject restores the verbatim prior text and re-analyzes it.
        expect(next.scripts[scriptKey].script.toString()).toBe('SELECT 1 as a');
        expect(next.scripts[scriptKey].scriptAnalysis.outdated).toBe(false);
        expect(next.scripts[scriptKey].scriptAnalysis.buffers.analyzed).not.toBeNull();
    });

    it('REJECT frees the staged diff buffer', () => {
        const [staged, scriptKey] = stagePendingDiff('SELECT 1 as a', 'SELECT 2 as b');
        const destroySpy = vi.spyOn(staged.scripts[scriptKey].pendingDiff!.diffBuffer, 'destroy');
        reduce(staged, { type: REJECT_PENDING_DIFF, value: scriptKey });
        expect(destroySpy).toHaveBeenCalledTimes(1);
    });

    it('ACCEPT is a no-op when there is no pending diff (same state ref)', () => {
        const state = buildState();
        const scriptKey = getSelectedScriptFolder(state)!.scripts[state.scriptFocus.fileName].scriptId;
        const next = reduce(state, { type: ACCEPT_PENDING_DIFF, value: scriptKey });
        expect(next).toBe(state);
    });

    it('REJECT is a no-op when there is no pending diff (same state ref)', () => {
        const state = buildState();
        const scriptKey = getSelectedScriptFolder(state)!.scripts[state.scriptFocus.fileName].scriptId;
        const next = reduce(state, { type: REJECT_PENDING_DIFF, value: scriptKey });
        expect(next).toBe(state);
    });

    it('ACCEPT / REJECT are no-ops for an unknown scriptKey (same state ref)', () => {
        const state = buildState();
        expect(reduce(state, { type: ACCEPT_PENDING_DIFF, value: 99999 })).toBe(state);
        expect(reduce(state, { type: REJECT_PENDING_DIFF, value: 99999 })).toBe(state);
    });
});

// ---------------------------------------------------------------------------
// CREATE_SCRIPT_WITH_TEXT
// ---------------------------------------------------------------------------

describe('CREATE_SCRIPT_WITH_TEXT', () => {
    it('appends a new entry seeded with the provided text', () => {
        const state = buildState();
        const prevCount = pageEntryCount(state);
        const next = reduce(state, { type: CREATE_SCRIPT_WITH_TEXT, value: { text: 'SELECT 1 as x' } });
        expect(pageEntryCount(next)).toBe(prevCount + 1);
        const focusFile = next.scriptFocus.fileName;
        const newEntry = getSelectedScriptFolder(next)!.scripts[focusFile];
        expect(next.scripts[newEntry.scriptId].script.toString()).toBe('SELECT 1 as x');
    });

    it('analyzes the new entry before returning', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_SCRIPT_WITH_TEXT, value: { text: 'SELECT 1 as x, 2 as y' } });
        const focusFile = next.scriptFocus.fileName;
        const newEntry = getSelectedScriptFolder(next)!.scripts[focusFile];
        expect(next.scripts[newEntry.scriptId].scriptAnalysis.outdated).toBe(false);
        expect(next.scripts[newEntry.scriptId].scriptAnalysis.buffers.analyzed).not.toBeNull();
    });

    it('moves focus to the newly created entry', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_SCRIPT_WITH_TEXT, value: { text: 'SELECT 1' } });
        const files = getSortedScriptFileNames(getSelectedScriptFolder(next)!);
        expect(next.scriptFocus.fileName).toBe(files[files.length - 1]);
    });

});

// ---------------------------------------------------------------------------
// destroyNotebookScripts (notebook scripts teardown on notebook delete)
// ---------------------------------------------------------------------------

describe('destroyNotebookScripts', () => {
    // A live Wasm Ptr is registered in core.registeredMemory under its resultPtr; destroy()
    // unregisters it. So "is this object still alive?" reduces to a registry membership check.
    function isAlive(ptr: { resultPtr: number | null }): boolean {
        return ptr.resultPtr != null && dql!.registeredMemory.has(ptr.resultPtr);
    }

    it('frees every owned script', () => {
        const state = buildState();
        const scriptPtrs = Object.values(state.scripts).map(s => s.script.ptr);

        // Everything is alive before teardown.
        for (const p of scriptPtrs) {
            expect(isAlive(p)).toBe(true);
        }

        destroyNotebookScripts(state);

        // The notebook-owned Wasm is gone.
        for (const p of scriptPtrs) {
            expect(isAlive(p)).toBe(false);
        }
    });

    it('leaves the shared connection catalog alive (it is owned by the connection)', () => {
        const state = buildState();
        const catalogPtr = state.connectionCatalog.ptr!;

        destroyNotebookScripts(state);

        // destroyNotebookScripts drops the notebook's scripts FROM the catalog but must never destroy the
        // catalog itself — the connection owns it and DELETE_CONNECTION frees it separately.
        expect(isAlive(catalogPtr)).toBe(true);

        // Cleanup the catalog we created for this test.
        state.connectionCatalog.destroy();
    });
});

// Reference to keep imports used if other helpers are not consumed
void pageEntries;
