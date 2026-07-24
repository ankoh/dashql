import * as core from '../core/index.js';

import { ScriptDataMap } from './notebook_state.js';
import { NotebookPage, NotebookPageScript, normalizePageName } from './notebook_types.js';

/// A single cross-entry dependency edge within one notebook page.
///
/// `from` is the entry that references `to`; both are `scriptId`s. `fromFeedIndex`
/// / `toFeedIndex` are the entries' positions in feed order (used by the layout to
/// place ports and to guarantee the edge points backwards).
export interface PageDependency {
    /// The dependent entry (the one that references another).
    from: number;
    /// The referenced entry (the source).
    to: number;
    /// Feed index of the dependent entry.
    fromFeedIndex: number;
    /// Feed index of the referenced entry.
    toFeedIndex: number;
}

/// A reference from an entry on the current page to a script owned by *another*
/// page. Attributed to the target page (not the exact target script), so multiple
/// references from one entry into the same page collapse to a single edge — this
/// backs the "one placeholder card per referenced page" bar above the grid.
export interface PageReferenceDependency {
    /// The referencing entry on the current page (scriptId).
    from: number;
    /// Feed index of the referencing entry.
    fromFeedIndex: number;
    /// The clean (display) name of the referenced page.
    targetPageName: string;
}

/// The full dependency picture of a page: intra-page edges (card ↔ card) and
/// cross-page references (card → other page).
export interface PageDependencies {
    /// Dependency edges between entries on this page.
    intra: PageDependency[];
    /// References that leave this page, grouped per target page + referencing entry.
    crossPage: PageReferenceDependency[];
}

/// Compute the cross-entry dependency edges of a single notebook page.
///
/// Each notebook script is loaded into the catalog under its `scriptKey`, so the
/// analyzer already resolves every reference for us: a resolved table reference
/// carries an `ExternalObjectID` in `catalogTableId()` whose origin is the
/// catalog-entry id (= the owning script's `scriptKey`). A dependency is simply a
/// reference that resolves to a table owned by *another* entry on this page — no
/// name parsing or namespace matching needed. This covers both plain-SQL `FROM`
/// clauses and `VISUALIZE`, since the analyzer records the vis source as a
/// resolved table reference too.
///
/// Only backward edges are kept (`toFeedIndex < fromFeedIndex`), which drops self-
/// and forward-references and guarantees the intra-page edge set is a DAG in feed order.
///
/// A reference whose owner is *not* on this page is instead attributed to the page it
/// lives on: notebook scripts are registered under the qualified name
/// `dashql.notebook."<page>/<script>"`, so the target page is simply the segment of the
/// resolved table name before the first `/`. This needs no scriptId→page index — the page
/// identity rides the same C++ catalog resolution as every other table reference. Such
/// references become `crossPage` entries (deduplicated per target page) that back the
/// placeholder cards in the page-reference bar.
export function computePageDependencies(
    entries: NotebookPageScript[],
    scripts: ScriptDataMap,
    page: NotebookPage,
): PageDependencies {
    // scriptKey (catalog entry id) -> feed index, scoped to this page. A reference whose owner is
    // absent here resolves to another page (handled as a cross-page ref) or the catalog proper.
    const feedIndexByScriptId = new Map<number, number>();
    entries.forEach((entry, feedIndex) => {
        feedIndexByScriptId.set(entry.scriptId, feedIndex);
    });
    const currentPageName = normalizePageName(page.folderName);

    const intra: PageDependency[] = [];
    const crossPage: PageReferenceDependency[] = [];
    const tmpRef = new core.buffers.analyzer.TableReference();
    const tmpResolved = new core.buffers.analyzer.ResolvedTable();

    entries.forEach((entry, fromFeedIndex) => {
        const analyzedPtr = scripts[entry.scriptId]?.scriptAnalysis.buffers.analyzed;
        if (!analyzedPtr) return;
        const analyzed = analyzedPtr.read();

        // Referenced entries collected as feed indices; deduplicated so multiple refs to the same
        // source card (e.g. a join plus a VISUALIZE) yield one edge.
        const referencedFeedIndices = new Set<number>();
        // Referenced other pages, deduplicated so many refs into one page yield a single edge.
        const referencedPageNames = new Set<string>();

        for (let i = 0; i < analyzed.tableReferencesLength(); ++i) {
            const ref = analyzed.tableReferences(i, tmpRef);
            const resolved = ref?.resolvedTable(tmpResolved);
            if (!resolved) continue;
            const catalogTableId = resolved.catalogTableId();
            if (core.ExternalObjectID.isNull(catalogTableId)) continue;
            // The owning script of the resolved table.
            const ownerScriptId = core.ExternalObjectID.getOrigin(catalogTableId);
            const toFeedIndex = feedIndexByScriptId.get(ownerScriptId);
            if (toFeedIndex !== undefined) {
                // Owner is on this page: keep only backward references to another entry.
                if (toFeedIndex < fromFeedIndex) referencedFeedIndices.add(toFeedIndex);
                continue;
            }
            // Owner is elsewhere. Recover the target page from the resolved notebook path
            // (`notebook."<page>/<script>"`): the page is the segment before the first `/`.
            const qualified = resolved.tableName();
            if (qualified?.schemaName() !== 'notebook') continue;
            const path = qualified.tableName() ?? '';
            const slash = path.indexOf('/');
            if (slash <= 0) continue;
            const targetPageName = normalizePageName(path.slice(0, slash));
            if (targetPageName === currentPageName) continue;
            referencedPageNames.add(targetPageName);
        }

        for (const toFeedIndex of referencedFeedIndices) {
            intra.push({
                from: entry.scriptId,
                to: entries[toFeedIndex].scriptId,
                fromFeedIndex,
                toFeedIndex,
            });
        }
        for (const targetPageName of referencedPageNames) {
            crossPage.push({ from: entry.scriptId, fromFeedIndex, targetPageName });
        }
    });

    return { intra, crossPage };
}
