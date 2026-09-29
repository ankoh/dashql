import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { EmbeddedDatabaseProvider, useEmbeddedDatabaseSetup } from './embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from './embedded_database.js';
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
    const hyperDb = { terminate: vi.fn() } as unknown as EmbeddedComputeDatabase;
    const setupWebHyperDB = vi.fn();

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        vi.mocked(hyperDb.terminate).mockReset();
        setupWebHyperDB.mockReset().mockResolvedValue(hyperDb);
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
                    <EmbeddedDatabaseProvider setupDatabase={setupWebHyperDB}>
                        <SetupConsumer context={context} onReady={(db) => resolveDb?.(db)} />
                    </EmbeddedDatabaseProvider>
                </LoggerProvider>
            );
        });

        return await dbPromise;
    }

    it('uses HyperDB on web platforms', async () => {
        const db = await renderAndSetup('web-test');

        expect(db).toBe(hyperDb);
        expect(setupWebHyperDB).toHaveBeenCalledTimes(1);
        expect(setupWebHyperDB).toHaveBeenCalledWith('web-test', getGlobalLogger(), undefined);
    });

    it('uses HyperDB on Electron', async () => {
        const db = await renderAndSetup('electron-test');

        expect(db).toBe(hyperDb);
        expect(setupWebHyperDB).toHaveBeenCalledWith('electron-test', getGlobalLogger(), undefined);
    });

    it('forwards setup progress to HyperDB setup', async () => {
        const onSetupProgress = vi.fn();
        let resolveDb: ((db: any) => void) | null = null;
        const dbPromise = new Promise<any>((resolve) => { resolveDb = resolve; });

        await act(async () => {
            root.render(
                <LoggerProvider>
                    <EmbeddedDatabaseProvider setupDatabase={setupWebHyperDB}>
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

        expect(setupWebHyperDB).toHaveBeenCalledWith(
            'progress-test',
            getGlobalLogger(),
            onSetupProgress,
        );
    });

    it('retries after initialization fails', async () => {
        const failure = new Error('initialization failed');
        setupWebHyperDB
            .mockRejectedValueOnce(failure)
            .mockResolvedValueOnce(hyperDb);
        let setup: ReturnType<typeof useEmbeddedDatabaseSetup> | null = null;

        await act(async () => {
            root.render(
                <LoggerProvider>
                    <EmbeddedDatabaseProvider setupDatabase={setupWebHyperDB}>
                        <SetupCapture onSetup={(value) => { setup = value; }} />
                    </EmbeddedDatabaseProvider>
                </LoggerProvider>
            );
        });

        await expect(setup!('first-attempt')).rejects.toBe(failure);
        await expect(setup!('retry')).resolves.toBe(hyperDb);
        expect(setupWebHyperDB).toHaveBeenCalledTimes(2);
    });

});
