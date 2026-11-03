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

export function getBrowserTestModule(file: string): (() => Promise<unknown>) | null {
    const key = file.startsWith('src/tests/') ? `./${file.slice('src/tests/'.length)}` : `../${file.replace(/^src\//, '')}`;
    return BROWSER_TEST_MODULES[key] ?? null;
}
