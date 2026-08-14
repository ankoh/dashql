import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const commandDispatch = vi.hoisted(() => vi.fn());

vi.mock('../scripts/notebook_commands.js', () => ({
    NotebookCommandType: {
        ExecuteEditorQuery: 1,
        RefreshCatalog: 2,
    },
    useNotebookCommandDispatch: () => commandDispatch,
}));
vi.mock('../../../shared/ui/foundations/status_indicator.js', async () => {
    const React = await import('react');
    return {
        IndicatorStatus: { Running: 1 },
        StatusIndicator: () => React.createElement('span', { 'data-testid': 'status-indicator' }),
    };
});

import { ConnectionHealth, type ConnectionState } from '../connections/connection_state.js';
import { ConnectionCommandList } from './notebook_command_lists.js';

function createConnection(currentFullRefresh: number | null, runningTaskIds: number[]): ConnectionState {
    return {
        connectionHealth: ConnectionHealth.ONLINE,
        connectorInfo: {
            features: {
                executeQueryAction: true,
                refreshSchemaAction: true,
                healthChecks: false,
            },
            icons: { outlines: 'connector' },
        },
        catalogUpdates: {
            currentFullRefresh,
            tasksRunning: new Map(runningTaskIds.map(taskId => [taskId, {}])),
        },
    } as unknown as ConnectionState;
}

describe('ConnectionCommandList', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        commandDispatch.mockClear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function renderConnection(connection: ConnectionState) {
        act(() => {
            root.render(<ConnectionCommandList conn={connection} notebookScripts={null} />);
        });
        return Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Catalog'))!;
    }

    it('shows an actionable refresh icon while idle', () => {
        const refresh = renderConnection(createConnection(null, []));

        expect(refresh.textContent).toContain('Refresh Catalog');
        expect(refresh.disabled).toBe(false);
        expect(refresh.getAttribute('aria-busy')).toBe('false');
        expect(refresh.querySelector('[data-testid="status-indicator"]')).toBeNull();

        act(() => refresh.click());
        expect(commandDispatch).toHaveBeenCalledWith(2);
    });

    it('executes the script from the sidebar action', () => {
        renderConnection(createConnection(null, []));

        const executeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Execute Script'));
        expect(executeButton).toBeDefined();
        expect(executeButton?.textContent).toContain('Ctrl + E');
        act(() => executeButton?.click());
        expect(commandDispatch).toHaveBeenCalledWith(1);
    });

    it('shows a disabled loading indicator without changing the label while refreshing', () => {
        const refresh = renderConnection(createConnection(7, [7]));

        expect(refresh.textContent).toContain('Refresh Catalog');
        expect(refresh.textContent).not.toContain('Refreshing Catalog');
        expect(refresh.disabled).toBe(true);
        expect(refresh.getAttribute('aria-busy')).toBe('true');
        expect(refresh.querySelector('[data-testid="status-indicator"]')).not.toBeNull();
    });

    it('returns to the refresh action after completion', () => {
        const refresh = renderConnection(createConnection(7, []));

        expect(refresh.textContent).toContain('Refresh Catalog');
        expect(refresh.disabled).toBe(false);
        expect(refresh.querySelector('[data-testid="status-indicator"]')).toBeNull();
    });
});
