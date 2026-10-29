import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';

import type { ConnectionSaveResult } from '../connection_persistence.js';
import { ConnectionHealth } from '../connection_state.js';
import { useCloseOnConnect, type CloseOnConnectProps } from './connection_settings_overlay.js';

const SESSIONS_FAILED: ConnectionSaveResult = {
    params: { trino: {} } as ConnectionSaveResult['params'],
    manifest: { status: 'written' },
    sessions: [{ sessionId: 's1', result: { status: 'failed', error: new Error('disk full') } }] as ConnectionSaveResult['sessions'],
};

function Probe(props: CloseOnConnectProps): null {
    useCloseOnConnect(props);
    return null;
}

describe('useCloseOnConnect', () => {
    let container: HTMLDivElement;
    let root: Root;
    let onClose: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        onClose = vi.fn<() => void>();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function render(overrides: Partial<CloseOnConnectProps>) {
        const props: CloseOnConnectProps = {
            isOpen: true,
            connectionId: 'c1',
            health: ConnectionHealth.NOT_STARTED,
            saving: false,
            saveResult: null,
            onClose,
            ...overrides,
        };
        act(() => root.render(<Probe {...props} />));
    }

    it('closes when a connect comes online', () => {
        render({});
        render({ health: ConnectionHealth.CONNECTING });
        expect(onClose).not.toHaveBeenCalled();
        render({ health: ConnectionHealth.ONLINE });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('stays open for a connection that is already online', () => {
        render({ health: ConnectionHealth.ONLINE });
        render({ health: ConnectionHealth.ONLINE, saving: true });
        render({ health: ConnectionHealth.ONLINE });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('stays open when the connect fails', () => {
        render({ health: ConnectionHealth.CONNECTING });
        render({ health: ConnectionHealth.FAILED });
        render({ health: ConnectionHealth.ONLINE });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('waits for a save to finish', () => {
        render({ health: ConnectionHealth.CONNECTING });
        render({ health: ConnectionHealth.ONLINE, saving: true });
        expect(onClose).not.toHaveBeenCalled();
        render({ health: ConnectionHealth.ONLINE });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('stays open while the save bar reports failed session copies', () => {
        render({ health: ConnectionHealth.CONNECTING });
        render({ health: ConnectionHealth.ONLINE, saveResult: SESSIONS_FAILED });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('ignores a connect of another connection', () => {
        render({ health: ConnectionHealth.CONNECTING });
        render({ connectionId: 'c2', health: ConnectionHealth.ONLINE });
        expect(onClose).not.toHaveBeenCalled();
    });
});
