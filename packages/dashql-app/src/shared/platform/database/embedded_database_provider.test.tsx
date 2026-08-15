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
    webDb: { kind: 'web', terminate: vi.fn() } as any,
    setupNativeDuckDB: vi.fn(),
    setupWebDuckDB: vi.fn(),
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
vi.mock('../duckdb/duckdb_provider_web.js', () => ({
    setupWebDuckDB: (...args: any[]) => mockState.setupWebDuckDB(...args),
}));

import { EmbeddedDatabaseProvider, useEmbeddedDatabaseSetup } from './embedded_database_provider.js';

function SetupConsumer(props: { context: string; onReady: (db: any) => void }) {
    const setup = useEmbeddedDatabaseSetup();
    React.useEffect(() => {
        void setup(props.context).then(props.onReady);
    }, [props.context, props.onReady, setup]);
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
        mockState.webDb.terminate.mockReset();
        mockState.setupNativeDuckDB.mockReset().mockResolvedValue(mockState.nativeDb);
        mockState.setupWebDuckDB.mockReset().mockResolvedValue(mockState.webDb);
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
        expect(mockState.setupWebDuckDB).not.toHaveBeenCalled();
    });

    it('uses the web setup helper on web platforms', async () => {
        const db = await renderAndSetup('web-test');

        expect(db).toBe(mockState.webDb);
        expect(mockState.setupWebDuckDB).toHaveBeenCalledTimes(1);
        expect(mockState.setupWebDuckDB).toHaveBeenCalledWith('web-test', mockState.logger);
        expect(mockState.setupNativeDuckDB).not.toHaveBeenCalled();
    });

    it('uses the native setup helper in native builds even before native platform globals exist', async () => {
        process.env.DASHQL_NATIVE_BUILD = 'true';

        const db = await renderAndSetup('native-build');

        expect(db).toBe(mockState.nativeDb);
        expect(mockState.setupNativeDuckDB).toHaveBeenCalledTimes(1);
        expect(mockState.setupNativeDuckDB).toHaveBeenCalledWith('native-build', mockState.logger);
        expect(mockState.setupWebDuckDB).not.toHaveBeenCalled();
    });
});
