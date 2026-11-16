import type { ChannelConnector } from '@ankoh/dashql/runtime/runtime';
import { connectEmbeddedHyper } from '@ankoh/dashql/platform/connections/embedded/embedded_database_channel';
import type { HyperParamsLike } from '@ankoh/dashql/platform/connections/hyper/local_cloud';
import type { EmbeddedDatabaseSetupFn } from '../platform/database/embedded_database_provider.js';

/// The channels of the runtime of the shell: the embedded Hyper of the page. The shell runs its statements on the
/// session of its connection (`connectEmbeddedSession`), the catalog loader of the runtime follows them.
export function shellChannelConnector(setupEmbeddedDatabase: EmbeddedDatabaseSetupFn): ChannelConnector {
    return {
        connect: async (_connectionId, request) => {
            if (request.type !== 'hyper' || request.kind !== 'embedded') throw new Error(`The shell connects no ${request.type} channels`);
            return await connectEmbeddedHyper(await setupEmbeddedDatabase('shell'), request.params as HyperParamsLike);
        },
    };
}
