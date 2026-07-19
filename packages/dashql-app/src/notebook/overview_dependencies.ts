import * as core from '../core/index.js';

import { ScriptDataMap } from './notebook_state.js';
import { NotebookPage, NotebookPageScript } from './notebook_types.js';

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
/// and forward-references and guarantees the edge set is a DAG in feed order.
export function computePageDependencies(
    entries: NotebookPageScript[],
    scripts: ScriptDataMap,
    _page: NotebookPage,
): PageDependency[] {
    // scriptKey (catalog entry id) -> feed index, scoped to this page. References that resolve to a
    // script outside this map (another page, the catalog proper) are ignored.
    const feedIndexByScriptId = new Map<number, number>();
    entries.forEach((entry, feedIndex) => {
        feedIndexByScriptId.set(entry.scriptId, feedIndex);
    });

    const dependencies: PageDependency[] = [];
    const tmpRef = new core.buffers.analyzer.TableReference();
    const tmpResolved = new core.buffers.analyzer.ResolvedTable();

    entries.forEach((entry, fromFeedIndex) => {
        const analyzedPtr = scripts[entry.scriptId]?.scriptAnalysis.buffers.analyzed;
        if (!analyzedPtr) return;
        const analyzed = analyzedPtr.read();

        // Referenced entries collected as feed indices; deduplicated so multiple refs to the same
        // source card (e.g. a join plus a VISUALIZE) yield one edge.
        const referencedFeedIndices = new Set<number>();

        for (let i = 0; i < analyzed.tableReferencesLength(); ++i) {
            const ref = analyzed.tableReferences(i, tmpRef);
            const resolved = ref?.resolvedTable(tmpResolved);
            if (!resolved) continue;
            const catalogTableId = resolved.catalogTableId();
            if (core.ExternalObjectID.isNull(catalogTableId)) continue;
            // The owning script of the resolved table.
            const ownerScriptId = core.ExternalObjectID.getOrigin(catalogTableId);
            const toFeedIndex = feedIndexByScriptId.get(ownerScriptId);
            // Keep only backward references to another entry on this page.
            if (toFeedIndex === undefined || toFeedIndex >= fromFeedIndex) continue;
            referencedFeedIndices.add(toFeedIndex);
        }

        for (const toFeedIndex of referencedFeedIndices) {
            dependencies.push({
                from: entry.scriptId,
                to: entries[toFeedIndex].scriptId,
                fromFeedIndex,
                toFeedIndex,
            });
        }
    });

    return dependencies;
}
