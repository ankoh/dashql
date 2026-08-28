import { WebLogger } from '../logger/web_logger.js';
import { setupWebHyperDB } from './hyperdb_provider_web.js';

export interface HyperDBCapabilityResult {
    answer?: number;
    durationMs: number;
    engine?: string;
    error?: string;
    initialized: boolean;
    mode: 'capability' | 'persistence-write' | 'persistence-verify';
    persisted?: boolean;
    value?: string;
    version?: string;
}

declare global {
    var __DASHQL_HYPERDB_CAPABILITY__: HyperDBCapabilityResult | undefined;
}

async function runHyperDBCapabilityTest(): Promise<HyperDBCapabilityResult> {
    const start = performance.now();
    const mode = new URL(location.href).searchParams.get('mode') ?? 'capability';
    if (mode !== 'capability' && mode !== 'persistence-write' && mode !== 'persistence-verify') {
        return { durationMs: 0, error: `Unknown capability mode: ${mode}`, initialized: false, mode: 'capability' };
    }
    const logger = new WebLogger();
    let database: Awaited<ReturnType<typeof setupWebHyperDB>> | null = null;
    try {
        database = await setupWebHyperDB('electron_capability', logger);
        if (mode === 'persistence-write') {
            await database.createPersistentDatabase('electron_persistence');
            const connection = await database.connect();
            try {
                await connection.attachPersistentDatabase('electron_persistence', 'persisted');
                await connection.query("CREATE TABLE persisted.public.probe(id INTEGER, value TEXT)");
                await connection.query("INSERT INTO persisted.public.probe VALUES (42, 'dashql-opfs-persistence')");
            } finally {
                await connection.close();
            }
            await database.checkpointPersistentDatabase('electron_persistence');
            return {durationMs: Math.floor(performance.now() - start), initialized: true, mode, persisted: true};
        }
        if (mode === 'persistence-verify') {
            await database.openPersistentDatabase('electron_persistence');
            const connection = await database.connect();
            try {
                await connection.attachPersistentDatabase('electron_persistence', 'persisted');
                const table = await connection.query('SELECT id, value FROM persisted.public.probe');
                const row = table.get(0) as {id?: number; value?: string} | null;
                const persisted = table.numRows === 1 && row?.id === 42 && row.value === 'dashql-opfs-persistence';
                return {
                    answer: row?.id,
                    durationMs: Math.floor(performance.now() - start),
                    initialized: true,
                    mode,
                    persisted,
                    value: row?.value,
                };
            } finally {
                await connection.close();
                await database.dropPersistentDatabase('electron_persistence');
            }
        }
        const connection = await database.connect();
        try {
            const table = await connection.query("SELECT 42::INTEGER AS answer, 'hyper'::TEXT AS engine");
            const row = table.get(0) as { answer?: number; engine?: string } | null;
            return {
                answer: row?.answer,
                durationMs: Math.floor(performance.now() - start),
                engine: row?.engine,
                initialized: true,
                mode,
                version: await database.getVersion(),
            };
        } finally {
            await connection.close();
        }
    } catch (error) {
        return {
            durationMs: Math.floor(performance.now() - start),
            error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
            initialized: false,
            mode,
        };
    } finally {
        await database?.terminate();
        await logger.destroy();
    }
}

globalThis.__DASHQL_HYPERDB_CAPABILITY__ = await runHyperDBCapabilityTest();
