import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const mockState = vi.hoisted(() => ({
    isNative: false,
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
    nativeDb: { kind: 'native', terminate: vi.fn() } as any,
    hyperDb: { kind: 'hyper', terminate: vi.fn() } as any,
    setupNativeDuckDB: vi.fn(),
    setupWebHyperDB: vi.fn(),
}));

vi.mock('../logger/logger_provider.js', () => ({
    useLogger: () => mockState.logger,
}));
vi.mock('../native_globals.js', () => ({
    isNativePlatform: () => mockState.isNative,
}));
vi.mock('../duckdb/duckdb_provider_native.js', () => ({
    setupNativeDuckDB: (...args: any[]) => mockState.setupNativeDuckDB(...args),
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

        delete process.env.DASHQL_NATIVE_BUILD;
        mockState.isNative = false;
        mockState.logger.info.mockReset();
        mockState.logger.warn.mockReset();
        mockState.logger.error.mockReset();
        mockState.nativeDb.terminate.mockReset();
        mockState.hyperDb.terminate.mockReset();
        mockState.setupNativeDuckDB.mockReset().mockResolvedValue(mockState.nativeDb);
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

    it('uses the native setup helper without touching the web helper on native platforms', async () => {
        mockState.isNative = true;
        const db = await renderAndSetup('native-test');

        expect(db).toBe(mockState.nativeDb);
        expect(mockState.setupNativeDuckDB).toHaveBeenCalledTimes(1);
        expect(mockState.setupNativeDuckDB).toHaveBeenCalledWith('native-test', mockState.logger);
        expect(mockState.setupWebHyperDB).not.toHaveBeenCalled();
    });

    it('uses HyperDB on web platforms', async () => {
        const db = await renderAndSetup('web-test');

        expect(db).toBe(mockState.hyperDb);
        expect(mockState.setupWebHyperDB).toHaveBeenCalledTimes(1);
        expect(mockState.setupWebHyperDB).toHaveBeenCalledWith('web-test', mockState.logger, undefined);
        expect(mockState.setupNativeDuckDB).not.toHaveBeenCalled();
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

    it('uses the native setup helper in native builds even before native platform globals exist', async () => {
        process.env.DASHQL_NATIVE_BUILD = 'true';

        const db = await renderAndSetup('native-build');

        expect(db).toBe(mockState.nativeDb);
        expect(mockState.setupNativeDuckDB).toHaveBeenCalledTimes(1);
        expect(mockState.setupNativeDuckDB).toHaveBeenCalledWith('native-build', mockState.logger);
        expect(mockState.setupWebHyperDB).not.toHaveBeenCalled();
    });
});
