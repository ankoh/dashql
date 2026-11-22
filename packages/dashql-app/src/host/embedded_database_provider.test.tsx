import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

import { EmbeddedDatabaseProvider, useEmbeddedDatabaseSetup } from './embedded_database_provider.js';
import type { EmbeddedComputeDatabase } from '@akohn/dashql/platform/embedded_database';
import { LoggerProvider } from './logger_provider.js';

function SetupConsumer(props: {
    context: string;
    onSetupProgress?: (progress: { bytesLoaded: number; bytesTotal: number }) => void;
    onReady: (db: EmbeddedComputeDatabase) => void;
}) {
    const setup = useEmbeddedDatabaseSetup();
    React.useEffect(() => {
        void setup(props.context, props.onSetupProgress).then(props.onReady);
    }, [props.context, props.onSetupProgress, props.onReady, setup]);
    return null;
}

function SetupCapture(props: { onSetup: (setup: ReturnType<typeof useEmbeddedDatabaseSetup>) => void }) {
    const setup = useEmbeddedDatabaseSetup();
    const { onSetup } = props;
    React.useEffect(() => onSetup(setup), [onSetup, setup]);
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
        let resolveDb: ((db: EmbeddedComputeDatabase) => void) | null = null;
        const dbPromise = new Promise<EmbeddedComputeDatabase>((resolve) => {
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

    it('sets up HyperDB for its context', async () => {
        const db = await renderAndSetup('web-test');

        expect(db).toBe(hyperDb);
        expect(setupWebHyperDB).toHaveBeenCalledTimes(1);
        expect(setupWebHyperDB.mock.lastCall?.[0]).toBe('web-test');
    });

    it('forwards setup progress to HyperDB setup', async () => {
        const onSetupProgress = vi.fn();
        let resolveDb: ((db: EmbeddedComputeDatabase) => void) | null = null;
        const dbPromise = new Promise<EmbeddedComputeDatabase>((resolve) => { resolveDb = resolve; });

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

        expect(setupWebHyperDB.mock.lastCall?.[2]).toBe(onSetupProgress);
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

    it('waits for the startup options', async () => {
        let setup: ReturnType<typeof useEmbeddedDatabaseSetup> | null = null;
        const render = async (options: { experimentalWasmBackend?: boolean } | null) => {
            await act(async () => {
                root.render(
                    <LoggerProvider>
                        <EmbeddedDatabaseProvider setupDatabase={setupWebHyperDB} options={options}>
                            <SetupCapture onSetup={(value) => { setup = value; }} />
                        </EmbeddedDatabaseProvider>
                    </LoggerProvider>
                );
            });
        };

        await render(null);
        const pending = setup!('options-test');
        await act(async () => {});
        expect(setupWebHyperDB).not.toHaveBeenCalled();

        await render({ experimentalWasmBackend: true });
        await expect(pending).resolves.toBe(hyperDb);
        expect(setupWebHyperDB.mock.lastCall?.[3]).toEqual({ experimentalWasmBackend: true });
    });

});
