import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { SqlInput } from '@akohn/dashql/platform/sql/sql_lint';

/// The path that reads a script from stdin
export const STDIN = '-';
/// The id of the script from stdin
export const STDIN_ID = '<stdin>';

/// Catalog files that workbooks keep next to their scripts, they describe the connection and are not meant to run.
/// `dashql-functions.sql` and `dashql-relations.sql` are their names in older versions.
const GENERATED_FILES = new Set([
    'dashql-catalog-changes.sql',
    'dashql-catalog-functions.sql',
    'dashql-catalog-relations.sql',
    'dashql-functions.sql',
    'dashql-relations.sql',
]);

/// The directory the user invoked the CLI from. Under `bazel run` the process runs in the runfiles tree.
export function workingDirectory(): string {
    return process.env.BUILD_WORKING_DIRECTORY || process.cwd();
}

/// Text from bytes, invalid UTF-8 becomes U+FFFD
const DECODER = new TextDecoder('utf-8');

/// A path relative to the invoking directory, absolute for a file outside of it
function displayPath(file: string, cwd: string): string {
    const relative = path.relative(cwd, file);
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

/// The message of an error of the file system with its path
function withPath(file: string, error: unknown): string {
    const code = (error as { code?: string } | null)?.code;
    return `${file}: ${code ?? (error instanceof Error ? error.message : String(error))}`;
}

/// The *.sql files below a directory in the order of their names. `parents` are the real paths of the directories
/// being walked: a link back to one of them would repeat the scripts on every level, and with two such links never end.
async function walk(dir: string, parents: string[], out: string[]): Promise<void> {
    const real = await realpath(dir);
    if (parents.includes(real)) return;
    parents.push(real);
    const names = (await readdir(dir)).sort();
    for (const name of names) {
        const file = path.join(dir, name);
        // Follow symlinks, SQL libraries are often linked into place. A dangling link is skipped.
        let info;
        try {
            info = await stat(file);
        } catch {
            continue;
        }
        if (info.isDirectory()) {
            if (name !== 'node_modules' && !name.startsWith('.')) await walk(file, parents, out);
        } else if (info.isFile() && name.toLowerCase().endsWith('.sql') && !GENERATED_FILES.has(name)) {
            out.push(file);
        }
    }
    parents.pop();
}

/// Read SQL scripts from files, directories (recursively, *.sql only, without generated catalog files) and stdin
/// (`-`). A script is named by its path relative to the invoking directory and read once. Throws the message of an
/// error.
export async function readInputs(paths: string[], cwd: string, readStdin: () => Promise<Uint8Array>): Promise<SqlInput[]> {
    const inputs: SqlInput[] = [];
    const seen = new Set<string>();
    for (const arg of paths) {
        if (arg === STDIN) {
            let bytes: Uint8Array;
            try {
                bytes = await readStdin();
            } catch (error) {
                throw `stdin: ${error instanceof Error ? error.message : String(error)}`;
            }
            if (!seen.has(STDIN_ID)) {
                seen.add(STDIN_ID);
                inputs.push({ id: STDIN_ID, text: DECODER.decode(bytes) });
            }
            continue;
        }
        const root = path.resolve(cwd, arg);
        const files: string[] = [];
        try {
            if ((await stat(root)).isDirectory()) {
                await walk(root, [], files);
            } else {
                files.push(root);
            }
        } catch (error) {
            throw withPath(root, error);
        }
        for (const file of files) {
            const id = displayPath(file, cwd);
            if (seen.has(id)) continue;
            seen.add(id);
            let bytes: Uint8Array;
            try {
                bytes = await readFile(file);
            } catch (error) {
                throw withPath(file, error);
            }
            inputs.push({ id, text: DECODER.decode(bytes) });
        }
    }
    return inputs;
}
