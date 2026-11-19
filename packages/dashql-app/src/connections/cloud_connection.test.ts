import { describe, expect, it } from 'vitest';

import { cloudConnectionIdsOf, findCloudConnections } from './cloud_connection.js';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';

// Which connections can be clouds and which is a local cloud, the core decides (`clouds_among_connection_params` of
// the tests of the core runtime)
describe('cloud connection', () => {
    it('are found by their ids among the connections', () => {
        const c1 = { connectionId: 'c1' } as ConnectionState;
        const c2 = { connectionId: 'c2' } as ConnectionState;
        const connections = new Map([['c1', c1], ['c2', c2]]);
        expect(findCloudConnections(connections, ['c2', 'gone', 'c1'])).toEqual([c2, c1]);
        expect(findCloudConnections(connections, [])).toEqual([]);
    });

    it('reads the single cloud connection of earlier versions as the first cloud', () => {
        expect(cloudConnectionIdsOf(undefined)).toEqual([]);
        expect(cloudConnectionIdsOf({ cloudConnectionIds: ['a', 'b'] })).toEqual(['a', 'b']);
        expect(cloudConnectionIdsOf({ cloudConnectionIds: ['b', 'a', 'b'] })).toEqual(['b', 'a']);
    });
});
