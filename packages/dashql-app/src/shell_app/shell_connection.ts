import type { ChannelConnector } from '@akohn/dashql/runtime/runtime';
import { connectEmbeddedHyper } from '@akohn/dashql/platform/connections/embedded_database_channel';
import type { HyperParamsLike } from '@akohn/dashql/platform/connections/hyper/local_cloud';
import type { EmbeddedDatabaseSetupFn } from '../platform/embedded_database_provider.js';

/// The channels of the runtime of the shell: the embedded Hyper of the page. The shell runs its statements with the
/// query executor of the runtime on its connection (`connectEmbeddedSession`), the catalog loader follows them.
export function shellChannelConnector(setupEmbeddedDatabase: EmbeddedDatabaseSetupFn): ChannelConnector {
    return {
        connect: async (_connectionId, request) => {
            if (request.type !== 'hyper' || request.kind !== 'embedded') throw new Error(`The shell connects no ${request.type} channels`);
            return await connectEmbeddedHyper(await setupEmbeddedDatabase('shell'), request.params as HyperParamsLike);
        },
    };
}
