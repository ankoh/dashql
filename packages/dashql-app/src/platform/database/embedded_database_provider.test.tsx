import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const mockState = vi.hoisted(() => ({
    hyperDb: { kind: 'hyper', terminate: vi.fn() } as any,
    setupWebHyperDB: vi.fn(),
}));

vi.mock('../hyperdb/hyperdb_provider_web.js', () => ({
    setupWebHyperDB: (...args: any[]) => mockState.setupWebHyperDB(...args),
}));

import { EmbeddedDatabaseProvider, useEmbeddedDatabaseSetup } from './embedded_database_provider.js';
import { getGlobalLogger, LoggerProvider } from '../logger/logger_provider.js';

function SetupConsumer(props: {
    context: string;
    onSetupProgress?: (progress: { bytesLoaded: number; bytesTotal: number }) => void;
    onReady: (db: any) => void;
}) {
    const setup = useEmbeddedDatabaseSetup();
    React.useEffect(() => {
        void setup(props.context, props.onSetupProgress).then(props.onReady);
    }, [props.context, props.onSetupProgress, props.onReady, setup]);
    return null;
}

function SetupCapture(props: { onSetup: (setup: ReturnType<typeof useEmbeddedDatabaseSetup>) => void }) {
    const setup = useEmbeddedDatabaseSetup();
    React.useEffect(() => props.onSetup(setup), [props.onSetup, setup]);
    return null;
}

describe('EmbeddedDatabaseProvider', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        mockState.hyperDb.terminate.mockReset();
        mockState.setupWebHyperDB.mockReset().mockResolvedValue(mockState.hyperDb);
    });

    afterEach(() => {
        act(() => {
            root.unmount();
        });
        container.remove();
    });

    async function renderAndSetup(context: string) {
        let resolveDb: ((db: any) => void) | null = null;
        const dbPromise = new Promise<any>((resolve) => {
            resolveDb = resolve;
        });

        await act(async () => {
            root.render(
                <LoggerProvider>
                    <EmbeddedDatabaseProvider>
                        <SetupConsumer context={context} onReady={(db) => resolveDb?.(db)} />
                    </EmbeddedDatabaseProvider>
                </LoggerProvider>
            );
        });

        return await dbPromise;
    }

    it('uses HyperDB on web platforms', async () => {
        const db = await renderAndSetup('web-test');

        expect(db).toBe(mockState.hyperDb);
        expect(mockState.setupWebHyperDB).toHaveBeenCalledTimes(1);
        expect(mockState.setupWebHyperDB).toHaveBeenCalledWith('web-test', getGlobalLogger(), undefined);
    });

    it('uses HyperDB on Electron', async () => {
        const db = await renderAndSetup('electron-test');

        expect(db).toBe(mockState.hyperDb);
        expect(mockState.setupWebHyperDB).toHaveBeenCalledWith('electron-test', getGlobalLogger(), undefined);
    });

    it('forwards setup progress to HyperDB setup', async () => {
        const onSetupProgress = vi.fn();
        let resolveDb: ((db: any) => void) | null = null;
        const dbPromise = new Promise<any>((resolve) => { resolveDb = resolve; });

        await act(async () => {
            root.render(
                <LoggerProvider>
                    <EmbeddedDatabaseProvider>
                        <SetupConsumer
                            context="progress-test"
                            onSetupProgress={onSetupProgress}
                            onReady={(db) => resolveDb?.(db)}
                        />
                    </EmbeddedDatabaseProvider>
                </LoggerProvider>
            );
        });
        await dbPromise;

        expect(mockState.setupWebHyperDB).toHaveBeenCalledWith(
            'progress-test',
            getGlobalLogger(),
            onSetupProgress,
        );
    });

    it('retries after initialization fails', async () => {
        const failure = new Error('initialization failed');
        mockState.setupWebHyperDB
            .mockRejectedValueOnce(failure)
            .mockResolvedValueOnce(mockState.hyperDb);
        let setup: ReturnType<typeof useEmbeddedDatabaseSetup> | null = null;

        await act(async () => {
            root.render(
                <LoggerProvider>
                    <EmbeddedDatabaseProvider>
                        <SetupCapture onSetup={(value) => { setup = value; }} />
                    </EmbeddedDatabaseProvider>
                </LoggerProvider>
            );
        });

        await expect(setup!('first-attempt')).rejects.toBe(failure);
        await expect(setup!('retry')).resolves.toBe(mockState.hyperDb);
        expect(mockState.setupWebHyperDB).toHaveBeenCalledTimes(2);
    });

});
