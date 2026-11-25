// Regenerate the bundled function catalog of the embedded Hyper from the `pg_proc` of hyperdb-wasm of the workspace:
// bazel run //scripts:update_hyper_functions
//
// The file declares every function by its name, `CREATE FUNCTION "hyper"."<schema>"."<name>"() RETURNS any`, and an
// aggregate with CREATE AGGREGATE: the signatures of Hyper's built-in functions in pg_proc are incomplete. It lists all
// functions that the embedded Hyper has, the catalog loader marks them complete and the analyzer warns about calls of
// other functions. Run it after an update of hyperdb-wasm.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HyperDB } from 'hyperdb-wasm';

const workspace = process.env.BUILD_WORKSPACE_DIRECTORY;
if (workspace == null) {
    console.error('update_hyper_functions writes into the workspace, run it with');
    console.error('bazel run //scripts:update_hyper_functions');
    process.exit(2);
}
const output = join(workspace, 'packages/dashql-core-runtime/src/catalog_loader/prefetched_hyper_functions.sql');

// The functions that the catalog loader reads from the pg_proc of a Hyper server (catalog_loader/pg_proc.rs), one row
// per name: a name is an aggregate if one of its signatures is
const FUNCTIONS_QUERY = `
    SELECT n.nspname AS function_schema, p.proname AS function_name, bool_or(p.prokind = 'a') AS is_aggregate
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prokind IN ('f', 'a', 'w', 'p')
    GROUP BY n.nspname, p.proname
`;

const quote = name => `"${name.replaceAll('"', '""')}"`;
// Sorted by schema and name in the byte order of Rust (functions_sql of catalog_loader/sql.rs)
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const storage = mkdtempSync(join(tmpdir(), 'hyper-functions-'));
const db = await HyperDB.create({ storagePath: storage });
let rows;
try {
    const connection = await db.connect();
    try {
        const table = await connection.query(FUNCTIONS_QUERY);
        rows = table.toArray().map(row => ({
            schema: String(row.function_schema),
            name: String(row.function_name),
            aggregate: row.is_aggregate === true,
        }));
    } finally {
        await connection.close();
    }
} finally {
    await db.terminate();
    rmSync(storage, { recursive: true, force: true });
}
rows.sort((a, b) => compare(a.schema, b.schema) || compare(a.name, b.name));
if (!rows.some(row => row.schema === 'pg_catalog' && row.name === 'count' && row.aggregate)) {
    console.error('pg_proc has no aggregate pg_catalog.count, refusing to write a broken function catalog');
    process.exit(1);
}
const lines = rows.map(
    row =>
        `CREATE ${row.aggregate ? 'AGGREGATE' : 'FUNCTION'} "hyper".${quote(row.schema)}.${quote(row.name)}() RETURNS any;`,
);
writeFileSync(output, `${lines.join('\n')}\n`);
const aggregates = rows.filter(row => row.aggregate).length;
console.log(`update_hyper_functions: ${rows.length} functions, ${aggregates} aggregates, written to ${output}`);
