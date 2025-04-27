import * as dashql from '@ankoh/dashql-core';
import { FocusType, UserFocus } from '../../workbook/focus.js';
import { QUALIFIED_DATABASE_ID, QUALIFIED_SCHEMA_ID, QUALIFIED_TABLE_COLUMN_ID, QUALIFIED_TABLE_ID, QualifiedCatalogObjectID } from '../../workbook/catalog_object_id.js';

/// The rendering settings for a catalog level
export interface CatalogLevelRenderingSettings {
    /// The width of a node
    nodeWidth: number;
    /// The height of a node
    nodeHeight: number;
    /// The maximum children at this level
    maxUnpinnedChildren: number;
    /// The row gap
    rowGap: number;
    /// The column gap left of this entry
    columnGap: number;
}

export interface CatalogRenderingSettings {
    /// The virtualization settings
    virtual: {
        /// The number of prerendered pixels
        prerenderSize: number,
        /// The step size
        stepSize: number,
    },
    /// The rendering levels
    levels: {
        /// The database settings
        databases: CatalogLevelRenderingSettings;
        /// The schema settings
        schemas: CatalogLevelRenderingSettings;
        /// The table settings
        tables: CatalogLevelRenderingSettings;
        /// The column settings
        columns: CatalogLevelRenderingSettings;
    },
}

/// The flags for rendering catalog entries
export enum CatalogRenderingFlag {
    DEFAULT = 0,
    OVERFLOW = 0b1,

    SCRIPT_TABLE_REF = 0b1 << 1,
    SCRIPT_TABLE_REF_PATH = 0b1 << 2,
    SCRIPT_COLUMN_REF = 0b1 << 3,
    SCRIPT_COLUMN_REF_PATH = 0b1 << 4,

    FOCUS_TABLE_REF = 0b1 << 5,
    FOCUS_TABLE_REF_PATH = 0b1 << 6,
    FOCUS_COLUMN_REF = 0b1 << 7,
    FOCUS_COLUMN_REF_PATH = 0b1 << 8,
    FOCUS_COMPLETION_CANDIDATE = 0b1 << 9,
    FOCUS_COMPLETION_CANDIDATE_PATH = 0b1 << 10,
    FOCUS_CATALOG_ENTRY = 0b1 << 11,
    FOCUS_CATALOG_ENTRY_PATH = 0b1 << 12,
}

export const PINNED_BY_SCRIPT =
    CatalogRenderingFlag.SCRIPT_TABLE_REF |
    CatalogRenderingFlag.SCRIPT_TABLE_REF_PATH |
    CatalogRenderingFlag.SCRIPT_COLUMN_REF |
    CatalogRenderingFlag.SCRIPT_COLUMN_REF_PATH
    ;

export const PINNED_BY_FOCUS_TARGET =
    CatalogRenderingFlag.FOCUS_TABLE_REF |
    CatalogRenderingFlag.FOCUS_COLUMN_REF |
    CatalogRenderingFlag.FOCUS_COMPLETION_CANDIDATE |
    CatalogRenderingFlag.FOCUS_CATALOG_ENTRY
    ;

export const PINNED_BY_FOCUS_PATH =
    CatalogRenderingFlag.FOCUS_TABLE_REF_PATH |
    CatalogRenderingFlag.FOCUS_COLUMN_REF_PATH |
    CatalogRenderingFlag.FOCUS_COMPLETION_CANDIDATE_PATH |
    CatalogRenderingFlag.FOCUS_CATALOG_ENTRY_PATH
    ;

export const PINNED_BY_FOCUS =
    PINNED_BY_FOCUS_TARGET |
    PINNED_BY_FOCUS_PATH
    ;

/// Pinned by anything
export const PINNED_BY_ANYTHING = PINNED_BY_SCRIPT | PINNED_BY_FOCUS;


/// A span of catalog entries
interface CatalogEntrySpan {
    read(snap: dashql.DashQLCatalogSnapshotReader, index: number, obj?: dashql.buffers.FlatCatalogEntry): dashql.buffers.FlatCatalogEntry | null;
    length(snap: dashql.DashQLCatalogSnapshotReader): number;
}

class PendingLayoutUpdates {
    root: boolean;
    databases: Set<number>;
    schemas: Set<number>;
    tables: Set<number>;
    columns: Set<number>;

    constructor() {
        this.root = false;
        this.databases = new Set();
        this.schemas = new Set();
        this.tables = new Set();
        this.columns = new Set();
    }
}

interface WriteHeads {
    /// The writer for tracking the y-offset when the column level is collapsed
    yWithoutColumns: number;
    /// The writer for tracking the y-offset when the column level is expanded
    yWithColumns: number;
}


interface LayoutContext {
    /// The snapshot
    snapshot: dashql.DashQLCatalogSnapshotReader;
    /// The current writer
    writers: WriteHeads;
};

interface SearchContext {
    /// The snapshot
    snapshot: dashql.DashQLCatalogSnapshotReader;
    /// Are columns visible?
    withColumns: boolean;
    /// The current writer
    currentWriterY: number;
    /// The current writer
    entryPath: number[];
};

interface SubtreeHeights {
    /// The subtree heights when rendering without columns
    withoutColumns: Float32Array;
    /// The subtree heights when rendering with columns
    withColumns: Float32Array;
}

export enum CatalogLevel {
    Database = 0,
    Schema = 1,
    Table = 2,
    Column = 3,
}

interface CatalogLevelViewModel {
    /// The rendering settings
    settings: CatalogLevelRenderingSettings;
    /// The buffers
    entries: CatalogEntrySpan;
    /// The rendering flags
    entryFlags: Uint16Array;
    /// The subtree heights
    subtreeHeights: SubtreeHeights;
    /// The y positions as written during rendering (if visible)
    positionsY: Float32Array;
    /// The epochs in which this node was rendered
    renderedInEpoch: Uint32Array;
    /// The pinned entries
    pinnedEntries: Set<number>;
    /// The epochs in which this node was pinned
    pinnedInEpoch: Uint32Array;
    /// The scratch catalog entry
    scratchEntry: dashql.buffers.FlatCatalogEntry;
    /// The first focused element
    firstFocusedEntry: { epoch: number, entryId: number } | null;
}

/// A catalog rendering state
export class CatalogViewModel {
    /// The snapshot.
    /// We have to recreate the state for every new snapshot.
    snapshot: dashql.DashQLCatalogSnapshot;
    /// The rendering settings
    settings: CatalogRenderingSettings;

    /// The database entries
    databaseEntries: CatalogLevelViewModel;
    /// The schema entries
    schemaEntries: CatalogLevelViewModel;
    /// The table entries
    tableEntries: CatalogLevelViewModel;
    /// The column entries
    columnEntries: CatalogLevelViewModel;

    /// The next rendering epoch
    nextRenderingEpoch: number;
    /// The pin epoch counter
    nextPinEpoch: number;

    /// The total height of all nodes when columns are shown
    totalHeightWithColumns: number;
    /// The total height of all nodes when columns are not shown
    totalHeightWithoutColumns: number;

    /// The pending layout updates
    pendingLayoutUpdates: PendingLayoutUpdates;

    /// The begin of the scroll window
    scrollBegin: number;
    /// The end of the scroll window
    scrollEnd: number;
    /// The begin of the virtual scroll window
    virtualScrollBegin: number;
    /// The end of the virtual scroll window
    virtualScrollEnd: number;

    /// A temporary database object
    tmpDatabaseEntry: dashql.buffers.IndexedFlatDatabaseEntry;
    /// A temporary schema object
    tmpSchemaEntry: dashql.buffers.IndexedFlatSchemaEntry;
    /// A temporary table object
    tmpTableEntry: dashql.buffers.IndexedFlatTableEntry;

    constructor(snapshot: dashql.DashQLCatalogSnapshot, settings: CatalogRenderingSettings) {
        this.snapshot = snapshot;
        this.settings = settings;
        this.nextRenderingEpoch = 100;
        this.nextPinEpoch = 1;
        const snap = snapshot.read();
        this.databaseEntries = {
            settings: settings.levels.databases,
            entries: {
                read: (snap: dashql.DashQLCatalogSnapshotReader, index: number, obj?: dashql.buffers.FlatCatalogEntry) => snap.catalogReader.databases(index, obj),
                length: (snap: dashql.DashQLCatalogSnapshotReader) => snap.catalogReader.databasesLength(),
            },
            entryFlags: new Uint16Array(snap.catalogReader.databasesLength()),
            subtreeHeights: {
                withColumns: new Float32Array(snap.catalogReader.databasesLength()),
                withoutColumns: new Float32Array(snap.catalogReader.databasesLength()),
            },
            scratchEntry: new dashql.buffers.FlatCatalogEntry(),
            positionsY: new Float32Array(snap.catalogReader.databasesLength()),
            renderedInEpoch: new Uint32Array(snap.catalogReader.databasesLength()),
            pinnedEntries: new Set(),
            pinnedInEpoch: new Uint32Array(snap.catalogReader.databasesLength()),
            firstFocusedEntry: null,
        };
        this.schemaEntries = {
            settings: settings.levels.schemas,
            entries: {
                read: (snap: dashql.DashQLCatalogSnapshotReader, index: number, obj?: dashql.buffers.FlatCatalogEntry) => snap.catalogReader.schemas(index, obj),
                length: (snap: dashql.DashQLCatalogSnapshotReader) => snap.catalogReader.schemasLength(),
            },
            entryFlags: new Uint16Array(snap.catalogReader.schemasLength()),
            subtreeHeights: {
                withColumns: new Float32Array(snap.catalogReader.schemasLength()),
                withoutColumns: new Float32Array(snap.catalogReader.schemasLength()),
            },
            scratchEntry: new dashql.buffers.FlatCatalogEntry(),
            positionsY: new Float32Array(snap.catalogReader.schemasLength()),
            renderedInEpoch: new Uint32Array(snap.catalogReader.schemasLength()),
            pinnedEntries: new Set(),
            pinnedInEpoch: new Uint32Array(snap.catalogReader.schemasLength()),
            firstFocusedEntry: null,
        };
        this.tableEntries = {
            settings: settings.levels.tables,
            entries: {
                read: (snap: dashql.DashQLCatalogSnapshotReader, index: number, obj?: dashql.buffers.FlatCatalogEntry) => snap.catalogReader.tables(index, obj),
                length: (snap: dashql.DashQLCatalogSnapshotReader) => snap.catalogReader.tablesLength(),
            },
            entryFlags: new Uint16Array(snap.catalogReader.tablesLength()),
            subtreeHeights: {
                withColumns: new Float32Array(snap.catalogReader.tablesLength()),
                withoutColumns: new Float32Array(snap.catalogReader.tablesLength()),
            },
            scratchEntry: new dashql.buffers.FlatCatalogEntry(),
            positionsY: new Float32Array(snap.catalogReader.tablesLength()),
            renderedInEpoch: new Uint32Array(snap.catalogReader.tablesLength()),
            pinnedInEpoch: new Uint32Array(snap.catalogReader.tablesLength()),
            pinnedEntries: new Set(),
            firstFocusedEntry: null,
        };
        this.columnEntries = {
            settings: settings.levels.columns,
            entries: {
                read: (snap: dashql.DashQLCatalogSnapshotReader, index: number, obj?: dashql.buffers.FlatCatalogEntry) => snap.catalogReader.columns(index, obj),
                length: (snap: dashql.DashQLCatalogSnapshotReader) => snap.catalogReader.columnsLength(),
            },
            entryFlags: new Uint16Array(snap.catalogReader.columnsLength()),
            subtreeHeights: {
                withColumns: new Float32Array(snap.catalogReader.columnsLength()),
                withoutColumns: new Float32Array(),
            },
            scratchEntry: new dashql.buffers.FlatCatalogEntry(),
            positionsY: new Float32Array(snap.catalogReader.columnsLength()),
            renderedInEpoch: new Uint32Array(snap.catalogReader.columnsLength()),
            pinnedInEpoch: new Uint32Array(snap.catalogReader.columnsLength()),
            pinnedEntries: new Set(),
            firstFocusedEntry: null,
        };

        this.totalHeightWithoutColumns = 0;
        this.totalHeightWithColumns = 0;
        this.pendingLayoutUpdates = new PendingLayoutUpdates();

        this.scrollBegin = 0;
        this.scrollEnd = 200;
        this.virtualScrollBegin = 0;
        this.virtualScrollEnd = 300;

        this.tmpDatabaseEntry = new dashql.buffers.IndexedFlatDatabaseEntry();
        this.tmpSchemaEntry = new dashql.buffers.IndexedFlatSchemaEntry();
        this.tmpTableEntry = new dashql.buffers.IndexedFlatTableEntry();

        // Layout all entries.
        // This means users don't have to special-case the states without layout.
        this.layoutEntries();
    }

    get levels() {
        return [this.databaseEntries, this.schemaEntries, this.tableEntries, this.columnEntries];
    }

    /// Update the scroll window
    updateWindow(begin: number, end: number, virtualBegin: number, virtualEnd: number) {
        this.scrollBegin = begin;
        this.scrollEnd = end;
        this.virtualScrollBegin = virtualBegin;
        this.virtualScrollEnd = virtualEnd;
    }

    /// Layout entries at a level
    static layoutEntriesAtLevel(ctx: LayoutContext, levels: CatalogLevelViewModel[], levelId: number, entriesBegin: number, entriesCount: number) {
        const level = levels[levelId];
        let unpinnedChildCount = 0;
        let overflowChildCount = 0;
        let isFirstEntry = true;

        // Don't overflow children if we have maxUnPinnedChildren + 1 children.
        // Adding the overflow node to reference a single overflow does not make sense.
        const skipOverflow = entriesCount <= (level.settings.maxUnpinnedChildren + 1);

        for (let i = 0; i < entriesCount; ++i) {
            const entryId = entriesBegin + i;
            const entry = level.entries.read(ctx.snapshot, entryId, level.scratchEntry)!;
            const entryFlags = level.entryFlags[entryId];

            // Pinned and unpinned entries have the same height, so it doesn't matter that we're accounting for them here in the "wrong" order.

            // Skip the node if the node is UNPINNED and the child count hit the limit
            if ((entryFlags & PINNED_BY_ANYTHING) == 0) {
                ++unpinnedChildCount;
                if (unpinnedChildCount > level.settings.maxUnpinnedChildren && !skipOverflow) {
                    ++overflowChildCount;
                    level.entryFlags[entryId] |= CatalogRenderingFlag.OVERFLOW;
                    continue;
                }
            }
            // Clear any previous overflow flags
            level.entryFlags[entryId] &= ~CatalogRenderingFlag.OVERFLOW;

            // Special-case the last level since we skip writer updates there
            if (levelId == CatalogLevel.Column) {
                // Add row gap when first
                // We could also account for that in the end
                ctx.writers.yWithColumns += isFirstEntry ? 0 : level.settings.rowGap;
                isFirstEntry = false;
                // Bump writer
                ctx.writers.yWithColumns += level.settings.nodeHeight;
                // Store the subtree height
                level.subtreeHeights.withColumns[entryId] = level.settings.nodeHeight;

            } else {
                // Add row gap when first
                // We could also account for that in the end
                ctx.writers.yWithColumns += isFirstEntry ? 0 : level.settings.rowGap;
                ctx.writers.yWithoutColumns += isFirstEntry ? 0 : level.settings.rowGap;
                isFirstEntry = false;
                // Remember own position
                let thisPosWithColumns = ctx.writers.yWithColumns;
                let thisPosWithoutColumns = ctx.writers.yWithoutColumns;
                // Render child columns
                if (entry.childCount() > 0) {
                    this.layoutEntriesAtLevel(ctx, levels, levelId + 1, entry.childBegin(), entry.childCount());
                }
                // Bump writer if the columns didn't already
                ctx.writers.yWithColumns = Math.max(ctx.writers.yWithColumns, thisPosWithColumns + level.settings.nodeHeight);
                ctx.writers.yWithoutColumns = Math.max(ctx.writers.yWithoutColumns, thisPosWithoutColumns + level.settings.nodeHeight);
                // Store the subtree height
                // Note that we deliberately do not include the entries row gap here.
                // If we would, we couldn't update this easily from the children.
                // (We would have to know if our parent is the child)
                level.subtreeHeights.withColumns[entryId] = ctx.writers.yWithColumns - thisPosWithColumns;
                level.subtreeHeights.withoutColumns[entryId] = ctx.writers.yWithoutColumns - thisPosWithoutColumns;
            }
        }

        // Add space for the overflow node
        if (overflowChildCount > 0) {
            ctx.writers.yWithColumns += level.settings.rowGap;
            ctx.writers.yWithColumns += level.settings.nodeHeight;
            if (levelId < CatalogLevel.Column) {
                ctx.writers.yWithoutColumns += level.settings.rowGap;
                ctx.writers.yWithoutColumns += level.settings.nodeHeight;
            }
        }
    }

    /// Layout all entries
    layoutEntries() {
        const snap = this.snapshot.read();
        const databaseCount = this.databaseEntries.entries.length(snap);
        const ctx: LayoutContext = {
            snapshot: snap,
            writers: {
                yWithColumns: 0,
                yWithoutColumns: 0,
            },
        };
        CatalogViewModel.layoutEntriesAtLevel(ctx, this.levels, 0, 0, databaseCount);
        this.totalHeightWithColumns = ctx.writers.yWithColumns;
        this.totalHeightWithoutColumns = ctx.writers.yWithoutColumns;
    }

    /// Flush all pending layout updates
    layoutPendingEntries() {
        // XXX Shortcut
        this.layoutEntries();
    }

    /// Pin an element
    pinPath(catalog: dashql.buffers.FlatCatalog,
        epoch: number,
        flagsTarget: number,
        flagsPath: number,
        clearFlags: number,
        objectId: QualifiedCatalogObjectID
    ): void {
        // Resolve entry ids
        const entryIds: (number | null)[] = [null, null, null, null];
        switch (objectId.type) {
            case QUALIFIED_DATABASE_ID:
                entryIds[0] = dashql.findCatalogDatabaseById(catalog, objectId.value.database, this.tmpDatabaseEntry);
                break;
            case QUALIFIED_SCHEMA_ID:
                entryIds[0] = dashql.findCatalogDatabaseById(catalog, objectId.value.database, this.tmpDatabaseEntry);
                entryIds[1] = dashql.findCatalogSchemaById(catalog, objectId.value.schema, this.tmpSchemaEntry);
                break;
            case QUALIFIED_TABLE_ID:
                entryIds[0] = dashql.findCatalogDatabaseById(catalog, objectId.value.database, this.tmpDatabaseEntry);
                entryIds[1] = dashql.findCatalogSchemaById(catalog, objectId.value.schema, this.tmpSchemaEntry);
                entryIds[2] = dashql.findCatalogTableById(catalog, objectId.value.table, this.tmpTableEntry);
                break;
            case QUALIFIED_TABLE_COLUMN_ID:
                entryIds[0] = dashql.findCatalogDatabaseById(catalog, objectId.value.database, this.tmpDatabaseEntry);
                entryIds[1] = dashql.findCatalogSchemaById(catalog, objectId.value.schema, this.tmpSchemaEntry);
                entryIds[2] = dashql.findCatalogTableById(catalog, objectId.value.table, this.tmpTableEntry);
                if (entryIds[2] != null) {
                    const tableProto = catalog.tables(entryIds[2])!;
                    const tableChildrenBegin = tableProto.childBegin();
                    entryIds[3] = tableChildrenBegin + objectId.value.column;
                }
                break;
        }

        // Truncate nulls
        let notNullEntries = 0;
        for (; notNullEntries < entryIds.length && entryIds[notNullEntries] != null; ++notNullEntries);

        if (notNullEntries > 0) {
            // Update epoch and pin entries
            let wasOverflowing = [false, false, false, false];
            const levels = this.levels;
            for (let i = 0; i < notNullEntries - 1; ++i) {
                const entryId = entryIds[i]!;

                // Pin the entry
                wasOverflowing[i] = (levels[i].entryFlags[entryId] & CatalogRenderingFlag.OVERFLOW) != 0;
                levels[i].pinnedEntries.add(entryId);
                levels[i].pinnedInEpoch[entryId] = epoch;
                levels[i].entryFlags[entryId] &= ~clearFlags;
                levels[i].entryFlags[entryId] |= flagsPath;

                // Update first focused (if appropriate)
                const firstFocusedEntry = levels[i].firstFocusedEntry;
                if ((flagsPath & PINNED_BY_FOCUS) != 0 && (firstFocusedEntry == null || firstFocusedEntry.epoch != epoch || entryId < firstFocusedEntry.entryId)) {
                    levels[i].firstFocusedEntry = {
                        epoch,
                        entryId: entryId,
                    };
                }
            }

            // Pin last entry
            const lastLevel = notNullEntries - 1;
            const lastEntryId = entryIds[lastLevel]!;
            wasOverflowing[lastLevel] = (levels[lastLevel].entryFlags[lastEntryId] & CatalogRenderingFlag.OVERFLOW) != 0;
            levels[lastLevel].pinnedEntries.add(lastEntryId);
            levels[lastLevel].pinnedInEpoch[lastEntryId] = epoch;
            levels[lastLevel].entryFlags[lastEntryId] &= ~clearFlags;
            levels[lastLevel].entryFlags[lastEntryId] |= flagsTarget;

            // Update first focused (if appropriate)
            const firstFocusedEntry = levels[lastLevel].firstFocusedEntry;
            if ((flagsPath & PINNED_BY_FOCUS) != 0 && (firstFocusedEntry == null || firstFocusedEntry.epoch != epoch || lastEntryId < firstFocusedEntry.entryId)) {
                levels[lastLevel].firstFocusedEntry = {
                    epoch,
                    entryId: lastEntryId,
                };
            }

            // Determine the parent of the first overflowing node
            if (wasOverflowing[0]) {
                this.pendingLayoutUpdates.root = true;
            } else if (wasOverflowing[1]) {
                this.pendingLayoutUpdates.databases.add(entryIds[0]!);
            } else if (wasOverflowing[2]) {
                this.pendingLayoutUpdates.schemas.add(entryIds[1]!);
            } else if (wasOverflowing[3]) {
                this.pendingLayoutUpdates.tables.add(entryIds[2]!);
            }
        }
    }

    // Unpin old entries.
    unpin(pinFlags: number, currentEpoch: number): void {
        const snap = this.snapshot.read();

        // Find databases that are no longer pinned
        for (const catalogEntryId of this.databaseEntries.pinnedEntries) {
            // Only check entries pinned with certain flags
            let entryFlags = this.databaseEntries.entryFlags[catalogEntryId];
            if ((entryFlags & pinFlags) != 0) {
                // It was not pinned in this epoch?
                let pinnedInEpoch = this.databaseEntries.pinnedInEpoch[catalogEntryId];
                if (pinnedInEpoch != currentEpoch) {
                    // Then we clear the pin flags and check the database is no longer pinned
                    entryFlags &= ~pinFlags;
                    this.databaseEntries.entryFlags[catalogEntryId] = entryFlags;
                    // Is the entry no longer pinned?
                    // For databases that means that we have to layout everything.
                    if ((entryFlags & PINNED_BY_ANYTHING) == 0) {
                        this.databaseEntries.pinnedEntries.delete(catalogEntryId);
                        // Mark the root for updates
                        this.pendingLayoutUpdates.root = true;
                    }
                }
            }
        }

        // Check all other levels
        const levels: [CatalogLevelViewModel, Set<number>][] = [
            [this.schemaEntries, this.pendingLayoutUpdates.databases],
            [this.tableEntries, this.pendingLayoutUpdates.schemas],
            [this.columnEntries, this.pendingLayoutUpdates.tables],
        ];
        for (const [level, layoutUpdates] of levels) {
            // Find entries that are no longer pinned
            for (const catalogEntryId of level.pinnedEntries) {
                // Only check entries pinned with certain flags
                let entryFlags = level.entryFlags[catalogEntryId];
                if ((entryFlags & pinFlags) != 0) {
                    // It was not pinned in this epoch?
                    let pinnedInEpoch = level.pinnedInEpoch[catalogEntryId];
                    if (pinnedInEpoch != currentEpoch) {
                        // Then we clear the pin flags and check the database is no longer pinned
                        entryFlags &= ~pinFlags;
                        level.entryFlags[catalogEntryId] = entryFlags;
                        // Is the entry no longer pinned?
                        if ((entryFlags & PINNED_BY_ANYTHING) == 0) {
                            level.pinnedEntries.delete(catalogEntryId);
                            // Mark the parent for updates
                            const entry = level.entries.read(snap, catalogEntryId, level.scratchEntry)!;
                            const parentCatalogEntryId = entry!.flatParentIdx();
                            layoutUpdates.add(parentCatalogEntryId);
                        }
                    }
                }
            }
        }
    }


    // Pin all script refs
    pinScriptRefs(script: dashql.buffers.AnalyzedScript): void {
        const catalog = this.snapshot.read().catalogReader;
        const tmpTableRef = new dashql.buffers.TableReference();
        const tmpExpression = new dashql.buffers.Expression();
        const tmpResolvedColumnRef = new dashql.buffers.ResolvedColumnRefExpression();
        const tmpResolvedRelationExpr = new dashql.buffers.ResolvedRelationExpression();

        // Allocate an epoch
        const epoch = this.nextPinEpoch++;

        // Pin table references
        for (let i = 0; i < script.tableReferencesLength(); ++i) {
            const tableRef = script.tableReferences(i, tmpTableRef)!;
            if (tableRef.innerType() == dashql.buffers.TableReferenceSubType.ResolvedRelationExpression) {
                const resolved = tableRef.inner(tmpResolvedRelationExpr) as dashql.buffers.ResolvedRelationExpression;
                const objectId: QualifiedCatalogObjectID = {
                    type: QUALIFIED_TABLE_ID,
                    value: {
                        database: resolved.catalogDatabaseId(),
                        schema: resolved.catalogSchemaId(),
                        table: resolved.catalogTableId(),
                    }
                };
                this.pinPath(catalog, epoch, CatalogRenderingFlag.SCRIPT_TABLE_REF, CatalogRenderingFlag.SCRIPT_TABLE_REF_PATH, PINNED_BY_SCRIPT, objectId);
            }
        }

        // Pin resolved column references
        for (let i = 0; i < script.expressionsLength(); ++i) {
            const expr = script.expressions(i, tmpExpression)!;
            if (expr.innerType() == dashql.buffers.ExpressionSubType.ResolvedColumnRefExpression) {
                const resolved = expr.inner(tmpResolvedColumnRef) as dashql.buffers.ResolvedColumnRefExpression;
                const objectId: QualifiedCatalogObjectID = {
                    type: QUALIFIED_TABLE_COLUMN_ID,
                    value: {
                        database: resolved.catalogDatabaseId(),
                        schema: resolved.catalogSchemaId(),
                        table: resolved.catalogTableId(),
                        column: resolved.columnId(),
                    }
                };
                this.pinPath(catalog, epoch, CatalogRenderingFlag.SCRIPT_COLUMN_REF, CatalogRenderingFlag.SCRIPT_COLUMN_REF_PATH, PINNED_BY_SCRIPT, objectId);
            }
        }

        // Unpin all entries were pinned with the same flags in a previous epoch
        this.unpin(PINNED_BY_SCRIPT, epoch);
        // Now run all necessary layout updates
        this.layoutPendingEntries();
    }


    pinFocusedByUser(focus: UserFocus): void {
        const catalog = this.snapshot.read().catalogReader;
        const epoch = this.nextPinEpoch++;

        // Pin focused catalog objects
        for (const o of focus.catalogObjects) {
            let flagsTarget = 0;
            let flagsPath = 0;
            switch (o.focus) {
                case FocusType.COMPLETION_CANDIDATE:
                    flagsTarget = CatalogRenderingFlag.FOCUS_COMPLETION_CANDIDATE;
                    flagsPath = CatalogRenderingFlag.FOCUS_COMPLETION_CANDIDATE_PATH;
                    break;
                case FocusType.CATALOG_ENTRY:
                    flagsTarget = CatalogRenderingFlag.FOCUS_CATALOG_ENTRY;
                    flagsPath = CatalogRenderingFlag.FOCUS_CATALOG_ENTRY_PATH;
                    break;
                case FocusType.TABLE_REF:
                    flagsTarget = CatalogRenderingFlag.FOCUS_TABLE_REF;
                    flagsPath = CatalogRenderingFlag.FOCUS_TABLE_REF_PATH;
                    break;
                case FocusType.COLUMN_REF:
                    flagsTarget = CatalogRenderingFlag.FOCUS_COLUMN_REF;
                    flagsPath = CatalogRenderingFlag.FOCUS_COLUMN_REF_PATH;
                    break;
            }
            this.pinPath(catalog, epoch, flagsTarget, flagsPath, PINNED_BY_FOCUS, o);
        }
        // Unpin previous catalog objects
        this.unpin(PINNED_BY_FOCUS, epoch);
        // Now run all necessary layout updates
        this.layoutPendingEntries();
    }

    static searchEntryOffsetAtLevel(ctx: SearchContext, levels: CatalogLevelViewModel[], levelId: number, entriesBegin: number, entriesCount: number): [number, boolean] {
        const level = levels[levelId];
        const flags = level.entryFlags;
        const targetEntryId = ctx.entryPath[levelId];
        const searchChildren = ctx.withColumns || ((levelId + 1) < CatalogLevel.Column);
        let isFirstEntry = true;

        for (const renderPinned of [true, false]) {
            for (let i = 0; i < entriesCount; ++i) {
                // Resolve table
                const entryId = entriesBegin + i;
                const entryFlags = flags[entryId];
                const entryIsPinned = (entryFlags & PINNED_BY_ANYTHING) != 0;

                // Not the right pass?
                if (entryIsPinned != renderPinned) {
                    continue;
                }
                // Is overflowing?
                if ((entryFlags & CatalogRenderingFlag.OVERFLOW) != 0) {
                    continue;
                }

                // Add row gap when first
                // We could also account for that in the end
                ctx.currentWriterY += isFirstEntry ? 0 : level.settings.rowGap;
                isFirstEntry = false;

                // Not there yet?
                // Just add the subtree height
                if (entryId < targetEntryId) {
                    ctx.currentWriterY += ctx.withColumns ? level.subtreeHeights.withColumns[entryId] : level.subtreeHeights.withoutColumns[entryId];
                    continue;
                }
                // Went past it?
                // Maybe the other pass (pinned vs !pinned)
                if (entryId > targetEntryId) {
                    break;
                }
                // Did we reach the end of the path?
                if ((levelId + 1) >= ctx.entryPath.length) {
                    // We found our entry id!
                    // Return the current writer as result
                    return [ctx.currentWriterY, true];
                }

                // Read entry
                const entry = level.entries.read(ctx.snapshot, entryId, level.scratchEntry)!;
                // Do we have children?
                if (searchChildren && (entry.childCount() > 0)) {
                    // Then traverse down and search there
                    return CatalogViewModel.searchEntryOffsetAtLevel(ctx, levels, levelId + 1, entry.childBegin(), entry.childCount());
                } else {
                    return [ctx.currentWriterY, false];
                }
            }
        }
        return [ctx.currentWriterY, false];
    }

    /// Search an entry offset
    searchEntryOffset(snap: dashql.DashQLCatalogSnapshotReader, withColumns: boolean, entryPath: number[]): [number, boolean] {
        const databaseCount = this.databaseEntries.entries.length(snap);
        const ctx: SearchContext = {
            snapshot: snap,
            withColumns,
            currentWriterY: 0,
            entryPath: entryPath
        };
        return CatalogViewModel.searchEntryOffsetAtLevel(ctx, this.levels, 0, 0, databaseCount);
    }

    /// Determine the offset of the first focused element
    getOffsetOfFirstFocused(withColumns: boolean = true): [number, boolean] {
        const snap = this.snapshot.read();
        const levels = this.levels;
        let maxEpoch = 0;
        let targetEntry = null;
        let targetLevel = null;
        for (let i = 0; i < levels.length; ++i) {
            const firstFocusedEntry = levels[i].firstFocusedEntry;
            if (firstFocusedEntry != null && firstFocusedEntry.epoch >= maxEpoch) {
                maxEpoch = firstFocusedEntry.epoch;
                targetEntry = firstFocusedEntry.entryId;
                targetLevel = i;
            }
        }
        // None focused?
        if (targetEntry == null) {
            return [0, false];
        }
        // Reconstruct entry path by following parent indices
        let entryPath: number[] = [];
        let childEntryIdx = targetEntry;
        for (let levelId = targetLevel!; levelId >= 0; --levelId) {
            entryPath.push(childEntryIdx);
            const level = levels[levelId];
            const childEntry = level.entries.read(snap, childEntryIdx, level.scratchEntry)!;
            const parentEntryIdx = childEntry.flatParentIdx();
            childEntryIdx = parentEntryIdx;
        }
        entryPath.reverse();

        // Construct the search context
        const databaseCount = this.databaseEntries.entries.length(snap);
        const ctx: SearchContext = {
            snapshot: snap,
            withColumns,
            currentWriterY: 0,
            entryPath: entryPath
        };
        // Search the offset
        return CatalogViewModel.searchEntryOffsetAtLevel(ctx, this.levels, 0, 0, databaseCount);
    }

    /// Get the first level that is not focused.
    getFirstUnfocusedLevel(): number {
        let firstUnfocused = this.levels.length;
        for (let i = 0; i < this.levels.length; ++i) {
            const firstFocusedEntry = this.levels[i].firstFocusedEntry;
            if (firstFocusedEntry == null || (firstFocusedEntry.epoch + 1) != this.nextPinEpoch) {
                firstUnfocused = i;
                break;
            }
        }
        return firstUnfocused;
    }
}
