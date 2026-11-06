export const BROWSER_TEST_MODULES = import.meta.glob([
    '../**/*.test.{ts,tsx}',
    // Also exclude stale copy_to_bin outputs left behind by the core extraction.
    '!../core/**',
]);

// The glob names the test files of this folder ./name, the others ../folder/name
function normalizePath(path: string): string {
    return path.startsWith('./') ? `src/tests/${path.slice(2)}` : path.replace(/^\.\.\//, 'src/');
}

export const BROWSER_TEST_FILES = Object.keys(BROWSER_TEST_MODULES)
    .map(normalizePath)
    .sort();

export const BLOCKED_BROWSER_TEST_FILES: readonly string[] = [];

/// The test files that take seconds in a run. A shard should get as much of them as of the many short files, they only
/// balance the shards, so a stale number just makes a run a bit slower.
const SLOW_TEST_FILE_SECONDS = new Map([
    ['src/connections/hyper/hyper_log_metrics.test.ts', 15],
    ['src/platform/hyperdb/integration/hyper_log_extract.test.ts', 13],
    ['src/platform/hyperdb/integration/hyper_resource_metrics.test.ts', 5],
    ['src/session/snippets/snippet_execution.test.ts', 4.5],
    ['src/platform/hyperdb/hyperdb_wasm.integration.test.ts', 3.5],
    ['src/ui/http/http_request_viewer.test.tsx', 2],
    ['src/session/shell/session_shell_page.test.tsx', 2],
    ['src/platform/hyperdb/integration/experimental_wasm_backend.test.ts', 1.5],
]);
const SHORT_TEST_FILE_SECONDS = 0.1;

/// The engine restart tests register first in a shard, like in test_bundle.ts
const FIRST_TEST_FILES = [
    'src/platform/hyperdb/hyperdb_wasm.integration.test.ts',
    'src/platform/hyperdb/integration/iceberg.test.ts',
];

/// The test files of one of several browser pages that run the suite at the same time.
/// The longest files go first, every file goes to the shard with the fewest seconds so far.
export function getBrowserTestShard(index: number, count: number): string[] {
    const seconds = (file: string) => SLOW_TEST_FILE_SECONDS.get(file) ?? SHORT_TEST_FILE_SECONDS;
    const shards = Array.from({ length: count }, () => ({ files: [] as string[], seconds: 0 }));
    for (const file of [...BROWSER_TEST_FILES].sort((a, b) => seconds(b) - seconds(a))) {
        const shard = shards.reduce((lightest, next) => next.seconds < lightest.seconds ? next : lightest);
        shard.files.push(file);
        shard.seconds += seconds(file);
    }
    const isFirst = (file: string) => FIRST_TEST_FILES.includes(file);
    return shards[index].files.sort((a, b) => Number(isFirst(b)) - Number(isFirst(a)) || a.localeCompare(b));
}

export function getBrowserTestModule(file: string): (() => Promise<unknown>) | null {
    const key = file.startsWith('src/tests/') ? `./${file.slice('src/tests/'.length)}` : `../${file.replace(/^src\//, '')}`;
    return BROWSER_TEST_MODULES[key] ?? null;
}
