import * as dashql from '../core/index.js';

import { ConnectionRegistry } from '../connection/connection_registry.js';
import { NotebookRegistry } from '../notebook/notebook_state_registry.js';

export function checkMemoryLiveness(core: dashql.DashQL, connections: ConnectionRegistry, notebooks: NotebookRegistry) {
    const epoch = core.acquireLivenessEpoch();

    for (const v of connections.connectionMap.values()) {
        v.catalog.ptr?.markAliveInEpoch(epoch);
        v.catalog.snapshot?.ptr?.markAliveInEpoch(epoch);
    }
    for (const v of notebooks.notebookMap.values()) {
        v.scriptRegistry?.ptr?.markAliveInEpoch(epoch);
        v.semanticUserFocus?.registryColumnInfo?.markAliveInEpoch(epoch);

        for (const s of Object.values(v.scripts)) {
            s.script.ptr.markAliveInEpoch(epoch);
            s.scriptAnalysis?.parsed?.markAliveInEpoch(epoch);
            s.scriptAnalysis?.scanned?.markAliveInEpoch(epoch);
            s.scriptAnalysis?.analyzed?.markAliveInEpoch(epoch);
            s.cursor?.markAliveInEpoch(epoch);
            s.completion?.buffer.markAliveInEpoch(epoch);
            for (let stats of s.statistics.values()) {
                stats.markAliveInEpoch(epoch);
            }
        }
    }

    const liveness = core.checkMemoryLiveness(epoch);
    console.log(liveness);
}
