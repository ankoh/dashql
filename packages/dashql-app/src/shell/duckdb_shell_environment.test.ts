// @vitest-environment node
import { createDuckDBShellEnvironment } from './duckdb_shell_environment.js';

describe('DuckDB shell environment', () => {
    it('executes against the provided connection', async () => {
        const result = new Uint8Array([1, 2, 3]);
        const queryArrowIPC = vi.fn().mockResolvedValue(result);
        const environment = createDuckDBShellEnvironment({ queryArrowIPC } as any);

        await expect(environment.executeQuery('SELECT 42')).resolves.toBe(result);
        expect(queryArrowIPC).toHaveBeenCalledWith('SELECT 42');
    });

    it('rejects an already cancelled query before reaching DuckDB', async () => {
        const queryArrowIPC = vi.fn();
        const environment = createDuckDBShellEnvironment({ queryArrowIPC } as any);
        const abort = new AbortController();
        abort.abort();

        await expect(environment.executeQuery('SELECT 42', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
        expect(queryArrowIPC).not.toHaveBeenCalled();
    });
});
