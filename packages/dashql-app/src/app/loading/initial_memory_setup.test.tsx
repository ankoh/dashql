import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@ankoh/dashql-runtime/platform/logger/logger';
import { ConnectionHealth, type ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { useInitialMemorySetup, type InitialSetups } from './initial_memory_setup.js';

describe('initial Memory setup', () => {
    let container: HTMLDivElement;
    let root: Root;
    let database: ConnectionState;
    let setup: { setup: ReturnType<typeof vi.fn<InitialSetups['setup']>>; reset: ReturnType<typeof vi.fn<InitialSetups['reset']>>; cancel: ReturnType<typeof vi.fn<InitialSetups['cancel']>> };
    const logger = { warn: vi.fn() } as unknown as Logger;

    function Consumer(props: { workbookId: string | null; database: ConnectionState | null }) {
        useInitialMemorySetup(props.workbookId, props.database == null ? null : [props.database], setup, logger);
        return <div>Workbook visible</div>;
    }

    async function render(next = database, workbookId: string | null = 'workbook') {
        await act(async () => {
            root.render(<Consumer database={next} workbookId={workbookId} />);
            await Promise.resolve();
        });
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        database = {
            connectionId: 'memory',
            connectionHealth: ConnectionHealth.NOT_STARTED,
            params: { hyper: { protocol: 'WASM', endpoint: '' } },
            details: { value: { proto: { setupParams: { protocol: 'V3_HTTP' } } } },
        } as unknown as ConnectionState;
        setup = {
            setup: vi.fn<InitialSetups['setup']>().mockResolvedValue({ status: 'succeeded', message: null }),
            reset: vi.fn<InitialSetups['reset']>(),
            cancel: vi.fn<InitialSetups['cancel']>(),
        };
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('uses committed Memory params and never reconnects after disconnect or reselection', async () => {
        await render();
        expect(setup.setup).toHaveBeenCalledWith('memory');
        await render({ ...database, connectionHealth: ConnectionHealth.ONLINE });
        await render({ ...database, connectionHealth: ConnectionHealth.NOT_STARTED });
        await render(database, null);
        await render();
        expect(setup.setup).toHaveBeenCalledTimes(1);
    });

    it.each(['draft', 'committed HTTP', 'already online', 'cancelled'] as const)('does not start for %s on initial selection or later reset', async reason => {
        const httpParams = { hyper: {
            protocol: 'V3_HTTP' as const, endpoint: 'https://hyper',
            tls: { clientKeyPath: '', clientCertPath: '', caCertsPath: '' },
        } };
        const first = reason === 'draft'
            ? { ...database, paramsDraft: httpParams }
            : reason === 'committed HTTP'
                ? { ...database, params: httpParams }
                : { ...database, connectionHealth: reason === 'cancelled' ? ConnectionHealth.CANCELLED : ConnectionHealth.ONLINE };
        await render(first);
        await render(database);
        expect(setup.setup).not.toHaveBeenCalled();
    });

    it('starts each newly selected database once without blocking workbook visibility', async () => {
        setup.setup = vi.fn<InitialSetups['setup']>(() => new Promise(() => {}));
        await render();
        expect(container.textContent).toBe('Workbook visible');
        await render({ ...database, connectionId: 'second-memory' }, 'second-workbook');
        await render();
        expect(setup.setup).toHaveBeenCalledTimes(2);
    });

    it('cancels the setups that run when it unmounts and does not start a cancelled one again', async () => {
        setup.setup = vi.fn<InitialSetups['setup']>(() => new Promise(() => {}));
        await render();
        await render({ ...database, connectionHealth: ConnectionHealth.CANCELLED });
        await render();
        expect(setup.setup).toHaveBeenCalledTimes(1);
        act(() => root.unmount());
        expect(setup.cancel).toHaveBeenCalledWith('memory');
        root = createRoot(container);
    });
});
