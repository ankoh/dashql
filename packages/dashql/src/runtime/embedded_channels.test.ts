import { describe, expect, it, vi } from 'vitest';

import type * as core from '../core/index.js';
import { connectionClientContext } from '../platform/connections/hyper/hyper_client_context.js';
import type { EmbeddedComputeDatabase } from '../platform/embedded_database.js';
import { createEmbeddedChannelConnector } from './embedded_channels.js';

/// A channel request of a setup
function request(kind: 'embedded' | 'grpc'): core.RuntimeChannelRequest {
    return { type: 'hyper', kind, params: {}, session: { defaultDatabase: 'hyper', attachedDatabases: [] } };
}

describe('the channels of the embedded Hyper', () => {
    it('connects a session of the embedded database with the client context of the connection', async () => {
        const database = { connect: vi.fn(async () => ({})) };
        const setup = vi.fn(async () => database as unknown as EmbeddedComputeDatabase);
        const connector = createEmbeddedChannelConnector(setup);
        await connector.connect('memory', request('embedded'));
        expect(setup).toHaveBeenCalledWith('hyper_wasm_connector');
        expect(database.connect).toHaveBeenCalledWith(expect.objectContaining({ defaultDatabase: 'hyper', clientContext: connectionClientContext('memory') }));
    });

    it('refuses Hyper over gRPC without setting up the database', async () => {
        const setup = vi.fn();
        await expect(createEmbeddedChannelConnector(setup).connect('remote', request('grpc'))).rejects.toThrow('grpc');
        expect(setup).not.toHaveBeenCalled();
    });
});
