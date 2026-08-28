import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const mockState = vi.hoisted(() => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
    hyperDb: { kind: 'hyper', terminate: vi.fn() } as any,
    setupWebHyperDB: vi.fn(),
}));

vi.mock('../logger/logger_provider.js', () => ({
    useLogger: () => mockState.logger,
}));
vi.mock('../hyperdb/hyperdb_provider_web.js', () => ({
    setupWebHyperDB: (...args: any[]) => mockState.setupWebHyperDB(...args),
}));

import { EmbeddedDatabaseProvider, useEmbeddedDatabaseSetup } from './embedded_database_provider.js';

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

describe('EmbeddedDatabaseProvider', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        mockState.logger.info.mockReset();
        mockState.logger.warn.mockReset();
        mockState.logger.error.mockReset();
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
                <EmbeddedDatabaseProvider>
                    <SetupConsumer context={context} onReady={(db) => resolveDb?.(db)} />
                </EmbeddedDatabaseProvider>
            );
        });

        return await dbPromise;
    }

    it('uses HyperDB on web platforms', async () => {
        const db = await renderAndSetup('web-test');

        expect(db).toBe(mockState.hyperDb);
        expect(mockState.setupWebHyperDB).toHaveBeenCalledTimes(1);
        expect(mockState.setupWebHyperDB).toHaveBeenCalledWith('web-test', mockState.logger, undefined);
    });

    it('uses HyperDB on Electron', async () => {
        const db = await renderAndSetup('electron-test');

        expect(db).toBe(mockState.hyperDb);
        expect(mockState.setupWebHyperDB).toHaveBeenCalledWith('electron-test', mockState.logger, undefined);
    });

    it('forwards setup progress to HyperDB setup', async () => {
        const onSetupProgress = vi.fn();
        let resolveDb: ((db: any) => void) | null = null;
        const dbPromise = new Promise<any>((resolve) => { resolveDb = resolve; });

        await act(async () => {
            root.render(
                <EmbeddedDatabaseProvider>
                    <SetupConsumer
                        context="progress-test"
                        onSetupProgress={onSetupProgress}
                        onReady={(db) => resolveDb?.(db)}
                    />
                </EmbeddedDatabaseProvider>
            );
        });
        await dbPromise;

        expect(mockState.setupWebHyperDB).toHaveBeenCalledWith(
            'progress-test',
            mockState.logger,
            onSetupProgress,
        );
    });

});
