import * as core from '../core/index.js';
import * as pb from '../proto.js';
import * as buf from '@bufbuild/protobuf';

import {
    reduceNotebookState,
    NotebookState,
    createEmptyScriptData,
    ANALYZE_OUTDATED_SCRIPT,
    CATALOG_DID_UPDATE,
    CREATE_NOTEBOOK_ENTRY,
    CREATE_PAGE,
    DELETE_NOTEBOOK,
    DELETE_NOTEBOOK_ENTRY,
    PROMOTE_UNCOMMITTED_SCRIPT,
    REGISTER_QUERY,
    REORDER_NOTEBOOK_ENTRIES,
    RESTORE_NOTEBOOK,
    SELECT_ENTRY,
    SELECT_NEXT_ENTRY,
    SELECT_PAGE,
    SELECT_PREV_ENTRY,
    UPDATE_NOTEBOOK_ENTRY,
} from './notebook_state.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connection/connector_info.js';
import { StorageWriter, StorageWriteTaskVariant } from '../storage/storage_writer.js';
import { Logger } from '../platform/logger.js';

class NullLogger extends Logger {
    public destroy(): void { }
    protected flushPendingRecords(): void { }
}

class NullStorageWriter extends StorageWriter {
    public override async write(_key: string, _task: StorageWriteTaskVariant, _debounce?: number): Promise<void> { }
}

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL | null = null;
const logger = new NullLogger();
const storage = new NullStorageWriter(logger);

beforeAll(async () => {
    const wasmBinary = await DASHQL_PRECOMPILED;
    dql = await core.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});

afterEach(() => {
    dql!.resetUnsafe();
});

// Builds a minimal DEMO-connector NotebookState:
//   page[0].scripts        = [{ scriptId: committedKey }]
//   page[0].uncommittedScriptId = uncommittedKey
function buildState(): NotebookState {
    const catalog = dql!.createCatalog();
    const registry = dql!.createScriptRegistry();
    const [committedKey, committedData] = createEmptyScriptData(dql!, catalog);
    const [uncommittedKey, uncommittedData] = createEmptyScriptData(dql!, catalog);
    return {
        instance: dql!,
        notebookId: 1,
        notebookMetadata: buf.create(pb.dashql.notebook.NotebookMetadataSchema),
        connectorInfo: CONNECTOR_INFOS[ConnectorType.DEMO],
        connectionId: 1,
        connectionCatalog: catalog,
        scriptRegistry: registry,
        scripts: {
            [committedKey]: committedData,
            [uncommittedKey]: uncommittedData,
        },
        notebookPages: [
            buf.create(pb.dashql.notebook.NotebookPageSchema, {
                scripts: [
                    buf.create(pb.dashql.notebook.NotebookPageScriptSchema, {
                        scriptId: committedKey,
                        title: '',
                    }),
                ],
                uncommittedScriptId: uncommittedKey,
            }),
        ],
        notebookUserFocus: { pageIndex: 0, entryInPage: 0 },
        semanticUserFocus: null,
    };
}

function reduce(state: NotebookState, action: Parameters<typeof reduceNotebookState>[1]): NotebookState {
    return reduceNotebookState(state, action, storage, logger);
}

// ---------------------------------------------------------------------------
// SELECT_PAGE
// ---------------------------------------------------------------------------

describe('SELECT_PAGE', () => {
    it('navigates to a valid page index', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_PAGE, value: null });
        expect(s1.notebookPages.length).toBe(2);
        const s2 = reduce(s1, { type: SELECT_PAGE, value: 0 });
        expect(s2.notebookUserFocus.pageIndex).toBe(0);
    });

    it('clamps a high page index to the last page', () => {
        const state = buildState();
        const next = reduce(state, { type: SELECT_PAGE, value: 999 });
        expect(next.notebookUserFocus.pageIndex).toBe(state.notebookPages.length - 1);
    });

    it('clamps a negative page index to 0', () => {
        const state = buildState();
        const next = reduce(state, { type: SELECT_PAGE, value: -1 });
        expect(next.notebookUserFocus.pageIndex).toBe(0);
    });

    it('clears semanticUserFocus', () => {
        const state: NotebookState = {
            ...buildState(),
            semanticUserFocus: { registryColumnInfo: null } as any,
        };
        const next = reduce(state, { type: SELECT_PAGE, value: 0 });
        expect(next.semanticUserFocus).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// SELECT_NEXT_ENTRY / SELECT_PREV_ENTRY / SELECT_ENTRY
// ---------------------------------------------------------------------------

describe('SELECT_NEXT_ENTRY', () => {
    it('advances entryInPage', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null }); // now 2 entries, focus=1
        const s2 = reduce(
            { ...s1, notebookUserFocus: { pageIndex: 0, entryInPage: 0 } },
            { type: SELECT_NEXT_ENTRY, value: null },
        );
        expect(s2.notebookUserFocus.entryInPage).toBe(1);
    });

    it('is capped at the last entry', () => {
        const state = buildState(); // 1 committed entry, focus=0
        const next = reduce(state, { type: SELECT_NEXT_ENTRY, value: null });
        expect(next.notebookUserFocus.entryInPage).toBe(0);
    });
});

describe('SELECT_PREV_ENTRY', () => {
    it('decrements entryInPage', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const s2 = reduce(
            { ...s1, notebookUserFocus: { pageIndex: 0, entryInPage: 1 } },
            { type: SELECT_PREV_ENTRY, value: null },
        );
        expect(s2.notebookUserFocus.entryInPage).toBe(0);
    });

    it('clamps at 0', () => {
        const state = buildState();
        const next = reduce(state, { type: SELECT_PREV_ENTRY, value: null });
        expect(next.notebookUserFocus.entryInPage).toBe(0);
    });
});

describe('SELECT_ENTRY', () => {
    it('sets entryInPage directly', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const s2 = reduce(
            { ...s1, notebookUserFocus: { pageIndex: 0, entryInPage: 0 } },
            { type: SELECT_ENTRY, value: 1 },
        );
        expect(s2.notebookUserFocus.entryInPage).toBe(1);
    });

    it('clamps an out-of-range index', () => {
        const state = buildState();
        const next = reduce(state, { type: SELECT_ENTRY, value: 999 });
        expect(next.notebookUserFocus.entryInPage).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// CREATE_PAGE
// ---------------------------------------------------------------------------

describe('CREATE_PAGE', () => {
    it('appends a new page and allocates an uncommitted script', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_PAGE, value: null });
        expect(next.notebookPages.length).toBe(2);
        const newPage = next.notebookPages[1];
        expect(newPage.uncommittedScriptId).toBeGreaterThan(0);
        expect(next.scripts[newPage.uncommittedScriptId]).toBeDefined();
    });

    it('moves focus to the new page', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_PAGE, value: null });
        expect(next.notebookUserFocus.pageIndex).toBe(1);
        expect(next.notebookUserFocus.entryInPage).toBe(0);
    });

    it('new page has no committed entries', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_PAGE, value: null });
        expect(next.notebookPages[1].scripts.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// CREATE_NOTEBOOK_ENTRY
// ---------------------------------------------------------------------------

describe('CREATE_NOTEBOOK_ENTRY', () => {
    it('appends a new entry to the selected page', () => {
        const state = buildState();
        const prevEntryCount = state.notebookPages[0].scripts.length;
        const next = reduce(state, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        expect(next.notebookPages[0].scripts.length).toBe(prevEntryCount + 1);
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
        const lastIndex = next.notebookPages[0].scripts.length - 1;
        expect(next.notebookUserFocus.entryInPage).toBe(lastIndex);
    });

    it('new entry scriptId is present in the script map', () => {
        const state = buildState();
        const next = reduce(state, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const page = next.notebookPages[0];
        const newEntry = page.scripts[page.scripts.length - 1];
        expect(next.scripts[newEntry.scriptId]).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// DELETE_NOTEBOOK_ENTRY
// ---------------------------------------------------------------------------

describe('DELETE_NOTEBOOK_ENTRY', () => {
    it('removes the targeted entry', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null }); // 2 entries
        const next = reduce(s1, { type: DELETE_NOTEBOOK_ENTRY, value: 0 });
        expect(next.notebookPages[0].scripts.length).toBe(1);
    });

    it('is a no-op when only one entry remains', () => {
        const state = buildState(); // 1 committed entry
        const next = reduce(state, { type: DELETE_NOTEBOOK_ENTRY, value: 0 });
        expect(next.notebookPages[0].scripts.length).toBe(1);
    });

    it('is a no-op for an out-of-range index', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const next = reduce(s1, { type: DELETE_NOTEBOOK_ENTRY, value: 99 });
        expect(next.notebookPages[0].scripts.length).toBe(2);
    });

    it('adjusts focus down when deleting an entry before the focused entry', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const s2 = reduce(
            { ...s1, notebookUserFocus: { pageIndex: 0, entryInPage: 1 } },
            { type: DELETE_NOTEBOOK_ENTRY, value: 0 },
        );
        expect(s2.notebookUserFocus.entryInPage).toBe(0);
    });

    it('adjusts focus when deleting the focused entry', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const s2 = reduce(
            { ...s1, notebookUserFocus: { pageIndex: 0, entryInPage: 1 } },
            { type: DELETE_NOTEBOOK_ENTRY, value: 1 },
        );
        expect(s2.notebookUserFocus.entryInPage).toBe(0);
    });

    it('removes dead scripts from the script map', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const deletedScriptId = s1.notebookPages[0].scripts[1].scriptId;
        expect(s1.scripts[deletedScriptId]).toBeDefined();
        const next = reduce(
            { ...s1, notebookUserFocus: { pageIndex: 0, entryInPage: 0 } },
            { type: DELETE_NOTEBOOK_ENTRY, value: 1 },
        );
        expect(next.scripts[deletedScriptId]).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// UPDATE_NOTEBOOK_ENTRY
// ---------------------------------------------------------------------------

describe('UPDATE_NOTEBOOK_ENTRY', () => {
    it('updates the title of the targeted entry', () => {
        const state = buildState();
        const next = reduce(state, { type: UPDATE_NOTEBOOK_ENTRY, value: { entryIndex: 0, title: 'My Query' } });
        expect(next.notebookPages[0].scripts[0].title).toBe('My Query');
    });

    it('stores an empty string when title is null', () => {
        const state = buildState();
        const next = reduce(state, { type: UPDATE_NOTEBOOK_ENTRY, value: { entryIndex: 0, title: null } });
        expect(next.notebookPages[0].scripts[0].title).toBe('');
    });

    it('is a no-op for an out-of-range entry index', () => {
        const state = buildState();
        const next = reduce(state, { type: UPDATE_NOTEBOOK_ENTRY, value: { entryIndex: 99, title: 'X' } });
        expect(next).toBe(state);
    });
});

// ---------------------------------------------------------------------------
// REORDER_NOTEBOOK_ENTRIES
// ---------------------------------------------------------------------------

describe('REORDER_NOTEBOOK_ENTRIES', () => {
    it('moves an entry forward (index 0 → 1)', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null }); // 2 entries
        const idAt0 = s1.notebookPages[0].scripts[0].scriptId;
        const idAt1 = s1.notebookPages[0].scripts[1].scriptId;
        const next = reduce(s1, { type: REORDER_NOTEBOOK_ENTRIES, value: { oldIndex: 0, newIndex: 1 } });
        expect(next.notebookPages[0].scripts[0].scriptId).toBe(idAt1);
        expect(next.notebookPages[0].scripts[1].scriptId).toBe(idAt0);
    });

    it('moves an entry backward (index 1 → 0)', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const idAt0 = s1.notebookPages[0].scripts[0].scriptId;
        const idAt1 = s1.notebookPages[0].scripts[1].scriptId;
        const next = reduce(s1, { type: REORDER_NOTEBOOK_ENTRIES, value: { oldIndex: 1, newIndex: 0 } });
        expect(next.notebookPages[0].scripts[0].scriptId).toBe(idAt1);
        expect(next.notebookPages[0].scripts[1].scriptId).toBe(idAt0);
    });

    it('focus follows the moved entry when it was selected', () => {
        const s0 = buildState();
        const s1 = reduce(s0, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        // Focus on entry 0, move it to index 1
        const s2 = reduce(
            { ...s1, notebookUserFocus: { pageIndex: 0, entryInPage: 0 } },
            { type: REORDER_NOTEBOOK_ENTRIES, value: { oldIndex: 0, newIndex: 1 } },
        );
        expect(s2.notebookUserFocus.entryInPage).toBe(1);
    });

    it('is a no-op for out-of-range indices', () => {
        const state = buildState(); // only 1 entry, newIndex=99 is out of range
        const next = reduce(state, { type: REORDER_NOTEBOOK_ENTRIES, value: { oldIndex: 0, newIndex: 99 } });
        expect(next).toBe(state);
    });
});

// ---------------------------------------------------------------------------
// DELETE_NOTEBOOK_ENTRY
// ---------------------------------------------------------------------------

describe('DELETE_NOTEBOOK_ENTRY', () => {
    it('preserves the uncommitted script for the page', () => {
        const state = buildState();
        const stateWithSecondEntry = reduce(state, { type: CREATE_NOTEBOOK_ENTRY, value: null });
        const uncommittedScriptId = stateWithSecondEntry.notebookPages[0].uncommittedScriptId;

        const next = reduce(stateWithSecondEntry, { type: DELETE_NOTEBOOK_ENTRY, value: 1 });

        expect(next.notebookPages[0].uncommittedScriptId).toBe(uncommittedScriptId);
        expect(next.scripts[uncommittedScriptId]).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// PROMOTE_UNCOMMITTED_SCRIPT
// ---------------------------------------------------------------------------

describe('PROMOTE_UNCOMMITTED_SCRIPT', () => {
    it('appends the uncommitted script as a new committed entry', () => {
        const state = buildState();
        const prevUncommittedId = state.notebookPages[0].uncommittedScriptId;
        const prevEntryCount = state.notebookPages[0].scripts.length;
        const next = reduce(state, { type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
        expect(next.notebookPages[0].scripts.length).toBe(prevEntryCount + 1);
        const promotedEntry = next.notebookPages[0].scripts[next.notebookPages[0].scripts.length - 1];
        expect(promotedEntry.scriptId).toBe(prevUncommittedId);
    });

    it('allocates a new uncommitted script after promotion', () => {
        const state = buildState();
        const prevUncommittedId = state.notebookPages[0].uncommittedScriptId;
        const next = reduce(state, { type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
        const newUncommittedId = next.notebookPages[0].uncommittedScriptId;
        expect(newUncommittedId).not.toBe(prevUncommittedId);
        expect(next.scripts[newUncommittedId]).toBeDefined();
    });

    it('moves focus to the promoted entry', () => {
        const state = buildState();
        const next = reduce(state, { type: PROMOTE_UNCOMMITTED_SCRIPT, value: null });
        expect(next.notebookUserFocus.entryInPage).toBe(next.notebookPages[0].scripts.length - 1);
    });
});

// ---------------------------------------------------------------------------
// CATALOG_DID_UPDATE
// ---------------------------------------------------------------------------

describe('CATALOG_DID_UPDATE', () => {
    it('marks every script outdated', () => {
        const state = buildState();
        // Force one script to be outdated first
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
    it('sets outdatedAnalysis=false on the targeted script', () => {
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
        const next = reduce(state, { type: REGISTER_QUERY, value: [0, 0, scriptKey, 42] });
        expect(next.scripts[scriptKey].latestQueryId).toBe(42);
    });

    it('returns the unchanged state for an unknown scriptKey', () => {
        const state = buildState();
        const next = reduce(state, { type: REGISTER_QUERY, value: [0, 0, 99999, 1] });
        expect(next).toBe(state);
    });
});

// ---------------------------------------------------------------------------
// RESTORE_NOTEBOOK
// ---------------------------------------------------------------------------

describe('RESTORE_NOTEBOOK', () => {
    it('resets focus to page 0 entry 0', () => {
        const state: NotebookState = {
            ...buildState(),
            notebookUserFocus: { pageIndex: 0, entryInPage: 1 },
        };
        const notebook = buf.create(pb.dashql.notebook.NotebookSchema, {
            scripts: [
                buf.create(pb.dashql.notebook.NotebookScriptSchema, { scriptId: 1, scriptText: 'select 1' }),
            ],
            notebookPages: [
                buf.create(pb.dashql.notebook.NotebookPageSchema, {
                    scripts: [
                        buf.create(pb.dashql.notebook.NotebookPageScriptSchema, { scriptId: 1, title: 'q1' }),
                    ],
                    uncommittedScriptId: 0,
                }),
            ],
        });
        const next = reduce(state, { type: RESTORE_NOTEBOOK, value: notebook });
        expect(next.notebookUserFocus).toEqual({ pageIndex: 0, entryInPage: 0 });
    });

    it('produces the same number of pages as the proto', () => {
        const state = buildState();
        const notebook = buf.create(pb.dashql.notebook.NotebookSchema, {
            scripts: [
                buf.create(pb.dashql.notebook.NotebookScriptSchema, { scriptId: 1, scriptText: '' }),
            ],
            notebookPages: [
                buf.create(pb.dashql.notebook.NotebookPageSchema, {
                    scripts: [
                        buf.create(pb.dashql.notebook.NotebookPageScriptSchema, { scriptId: 1, title: '' }),
                    ],
                    uncommittedScriptId: 0,
                }),
            ],
        });
        const next = reduce(state, { type: RESTORE_NOTEBOOK, value: notebook });
        expect(next.notebookPages.length).toBe(1);
    });

    it('ensures every page has a valid uncommitted script', () => {
        const state = buildState();
        const notebook = buf.create(pb.dashql.notebook.NotebookSchema, {
            scripts: [
                buf.create(pb.dashql.notebook.NotebookScriptSchema, { scriptId: 1, scriptText: '' }),
            ],
            notebookPages: [
                buf.create(pb.dashql.notebook.NotebookPageSchema, {
                    scripts: [
                        buf.create(pb.dashql.notebook.NotebookPageScriptSchema, { scriptId: 1, title: '' }),
                    ],
                    uncommittedScriptId: 0,
                }),
            ],
        });
        const next = reduce(state, { type: RESTORE_NOTEBOOK, value: notebook });
        for (const page of next.notebookPages) {
            expect(page.uncommittedScriptId).toBeGreaterThan(0);
            expect(next.scripts[page.uncommittedScriptId]).toBeDefined();
        }
    });

    it('populates scripts from the proto', () => {
        const state = buildState();
        const notebook = buf.create(pb.dashql.notebook.NotebookSchema, {
            scripts: [
                buf.create(pb.dashql.notebook.NotebookScriptSchema, { scriptId: 1, scriptText: 'select 1' }),
                buf.create(pb.dashql.notebook.NotebookScriptSchema, { scriptId: 2, scriptText: 'select 2' }),
            ],
            notebookPages: [],
        });
        const next = reduce(state, { type: RESTORE_NOTEBOOK, value: notebook });
        expect(Object.keys(next.scripts).length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// DELETE_NOTEBOOK
// ---------------------------------------------------------------------------

describe('DELETE_NOTEBOOK', () => {
    it('returns an empty object for a DEMO connector', () => {
        const state = buildState();
        const next = reduce(state, { type: DELETE_NOTEBOOK, value: null });
        expect(next).toEqual({});
    });
});
