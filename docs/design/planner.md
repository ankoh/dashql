# Planner

`dashql_core_session::planner` builds a statement-level dependency DAG above the analyzer. It
consumes an ordered set of analyzed scripts without analyzing, publishing, or
modifying them. Session order, followed by statement order, defines the baseline
semantics; independent statements do not acquire source-order edges.

Scripts run on connections, and every connection has its own catalog. Relations of
different connections never conflict and barriers order the statements of their own
connection only. A script references the result of another script with a table
parameter, `select * from :foo` reads the single SELECT of `foo.sql`; the planner
inlines the referenced query or scans its result (see Script References and
`script_references.md`).

`planner_dependencies.md` describes the nodes and edges precisely and what a run of the session and a run of one
script execute.

## Preparation and API

The scripts of a connection share its catalog, and every planned script must have current parsing and
analysis for both its text and the catalog revision. Publish participating definitions before
refreshing every input's analysis. Publishing another script can invalidate an
earlier analysis, even if that script's text did not change: a publish that changes
declarations bumps the catalog revision, one with unchanged declarations does not
(`docs/design/core_analysis_catalog.md`).

The native API is `planner::plan_session(&SessionPlanRequest)` (`packages/dashql-core-session/src/planner.rs`).
A request lists the connections (`PlannerConnection`: the host id, the kind and the catalog), the scripts in
session order (`PlannerScript`: the live `Script`, its name and its connection index), the scope, the scripts
whose materialized results the host provides, the directory the host mounts materialized results in
(`mount_prefix`, e.g. `/mnt/external/cache`), the attachments of the session (`PlannerAttachment`: the name, the file
and its stamp) and the directory the host mounts them in (`attachment_prefix`). A script may name the file of its materialized result below the mount
prefix (`PlannerScript.materialization_file`, e.g. the cache entry of the result), `s<index>.parquet` otherwise. There is no caller-supplied revision. A script
analyzed with another catalog than the one of its connection, duplicate scripts or script names, duplicate
attachment files, connections that share a catalog and unknown indexes invalidate the plan. The connection kind comes from the host: LOCAL
is the embedded Hyper, every other connection is REMOTE.

The scope is the whole session (`PlanScope::Session`) or target scripts (`PlanScope::Targets`). A plan of the
session includes every statement of the scripts whose materialized results the host doesn't provide and that don't run
only on request (`@manual`, `AnalyzedScript.manual`), it checks every script. A script that runs on request is included
when it is a target and inlined into its consumers. A plan of targets includes every statement of the targets and the queries of the scripts that they materialize, unless the
host provides the materialized result. The targets, the scripts they reference and the scripts those reference must
have a current analysis, `ExecutionGraphScript.planned` marks them. `ExecutionGraphScript.target` marks the scripts
a plan includes in full: the targets, in a plan of the session the scripts whose results the host doesn't provide, in a
tolerant plan every script. A plan of targets runs like a
single script: the statements of a script are chained with SEQUENCE edges and a target that does not parse becomes
one barrier node with its text as written. In every scope statements keep their SQL whatever their kind and the
diagnostics of statements are warnings: a statement that the planner can't classify is a barrier and runs in session
order. Syntax errors in a plan of the session, diagnostics of script references, stale analysis (outside a tolerant
plan), inputs without a value, visualizations that fail to compile and a referenced script that runs later are
errors.

A tolerant plan (`PlanScope::Tolerant`) is the plan of the [dataflow](dataflow.md) of a session, which is never run.
It plans every script like a plan of targets that targets all of them, but errors leave something out instead of
stopping the plan: a script without a current analysis is not planned, an analysis of an earlier catalog revision
is taken as it is, and script references with errors or to scripts that were not planned are not spliced. The
diagnostics keep their error flag, and a plan that left something out is not valid. An invalid request, e.g. two
scripts of the same name, still stops it.

Every run in the app executes a plan: a run of the session plans every script without a cached result, a run of one script plans
that script as the target (`script_references.md`). Scripts without names can't be referenced, so a plan of
scripts without names is a plan of their statement dependencies.
The core-js API is:

```typescript
const buffer = dashql.planSession({
    connections: [{ id: 'trino', local: false, catalog }],
    scripts: [{ name: 'foo', connection: 0, session }],
    targets: [0],
    mountPrefix: '/mnt/external/cache',
});
try {
    const graph = buffer.read().unpack();
    if (!graph.valid) {
        // Do not execute partial nodes from an invalid plan.
        throw new Error(graph.diagnostics.map(d => d.message).join('\n'));
    }
    // The unpacked graph owns its SQL and metadata independently of Wasm memory.
} finally {
    buffer.destroy();
}
```

Planning captures executable SQL, script IDs, text versions, catalog revisions, catalog
entities, unresolved references, accesses, edges, and diagnostics in
`execution_graph.fbs`. The graph also carries the connections, the materializations and the script
references. `graph.scripts[i]` is the `i`-th script of the request; it records the name, the connection, the
cache signature of its AST, whether its result can be cached (its statements are queries and the scripts it
references can be cached), its terminal statement and the scripts it references. A node records its
connection, whether it is the terminal output of its script (`script_result`), the materialization its result
is written to, and the materializations to mount before it runs (`inputs`). Diagnostics name their script, the
text they are about (e.g. a table parameter) and whether they invalidate the plan (`error`). The authoritative native `Script::text_version()` is the
single shared 64-bit text version; `ScriptSession::text_version()` derives it
from the script rather than maintaining an independent counter. Script metadata
records `text_version` directly from the live script, `analyzed_text_version` from
the text snapshot retained by analysis, and `analyzed_catalog_revision` captured
by analysis. Valid graphs have equal `text_version` and `analyzed_text_version`.
A plan is a snapshot, not a live view. Before execution, consumers must compare
each captured `text_version` for equality with the current `session.getTextVersion()`
and reject the graph if it changed. The catalog revision may move on: the catalog follows
the statements that run, and a plan holds the statements as written. A plan of the session or of targets rejects missing or stale
input analysis with diagnostics and no executable partial nodes, a tolerant plan leaves the script out or takes an
analysis of an earlier catalog revision.

Each `ExecutionGraphEntity` requires a typed `catalog_object_id` struct containing
`object_type`, `object_id` (`uint64`), and `sub_object_id` (`uint32`). It also carries
`catalog_database_id`, `catalog_schema_id`, and the separate `database_name`,
`schema_name`, and `name` components. Identity is the typed catalog ID, not a name
or graph-local index. For TABLE, `object_id` is the packed native catalog table ID
and `sub_object_id` is zero. Table ids are keyed by the declaring script and the
qualified name, so a table keeps its id across versions of the script. Views currently use TABLE declaration identities too.
The generic enum contains DEFERRED, DATABASE, SCHEMA, TABLE, COLUMN, and FUNCTION;
the current planner emits only real TABLE entities, never synthetic DEFERRED
entities for unresolved names.

`unresolved_references` is a separate vector of qualified name components with no
catalog identity. Accesses and non-barrier edges select exactly one target:
`entity` indexes `entities`, or `unresolved_reference` indexes
`unresolved_references`. The inactive field is `4294967295` (`UINT32_MAX`). Barrier
edges have both fields set to that sentinel. Node IDs and these target indices
are local to the graph. Edges point from prerequisites to dependents; a conflict
edge identifies the destination access's entity or unresolved reference.

For example, the unpacked core-js graph exposes typed IDs separately from vector
indices (64-bit IDs and revisions are JavaScript `bigint` values):

```typescript
const none = 0xffffffff;
for (const node of graph.nodes) {
    for (const access of node.accesses) {
        if (access.entity !== none) {
            const entity = graph.entities[access.entity];
            const id = entity.catalogObjectId!; // Required by the wire schema.
            console.log(id.objectType, id.objectId, id.subObjectId,
                        entity.catalogDatabaseId, entity.catalogSchemaId, entity.name);
        } else {
            const reference = graph.unresolvedReferences[access.unresolvedReference];
            console.log(reference.databaseName, reference.schemaName, reference.name);
        }
    }
}
```

The graph owns its SQL and metadata, not execution state, and does not imply that
database objects declared in the catalog already exist in the backend.

## Script References

A table parameter `:foo` that is the table of a table reference references the script `foo.sql` or the attachment
`foo.parquet`, an exact name or the only name that differs in case among the names of the scripts and the
attachments (`table_parameters::find_table_parameter`, which the analyzer, completion and `check_script_references`
share). The connections decide what it becomes:

| Statement | Referenced | Reference |
|---|---|---|
| same connection | script | inline: `with foo as (<query of foo>)` |
| LOCAL connection | script of another connection | scan: the node of `foo` writes its result to `<mount_prefix>/<file>`, MATERIALIZATION edge, `with foo as (select * from external('<path>', format => 'parquet'))` |
| REMOTE connection | script of another connection | error |
| LOCAL connection | attachment | attachment: `with foo as (select * from external('<attachment_prefix>/<file>', format => 'parquet'))` |
| REMOTE connection | attachment | error |

A referenced script is a single SELECT, so a reference never runs commands of the referenced script. A single call of
a client function that reads is referenced too, by a scan only (`script_references.md`, Client Function Calls). The common
table expressions of a statement are flattened: the references of an inlined query are resolved in
the context of the statement, every script appears once after the scripts it references. They go into the
outermost SELECT around the references, inside the parentheses of a subquery, and before the common table
expressions the SELECT already has, also under WITH RECURSIVE: at the statement start, before the query of
INSERT, CREATE TABLE AS and EXPLAIN, and into the subquery of a DELETE. The CTE is named after the script and
quoted where needed (`"brave_otter-2"`); a name that a relation or common table expression of the statement or
of an inlined query uses gets a suffix (`foo_2`), and the reference keeps the script name as alias
(`foo_2 as foo`) unless the statement reads a relation of that name. The attachments that the statement or an inlined
query reads come first, every attachment once (`ExecutionGraphNode.attachments`), an attachment is no node and adds
no edge. The graph lists the attachments of the request with their paths (`ExecutionGraph.attachments`). A statement with inline references reads the relations of the inlined queries, so it is ordered after their
writers.

Errors, each with the text of the parameter except the one of a script that runs later: an unknown or ambiguous name
("the table parameter :sales matches sales.sql and sales.parquet"), a positional table
parameter, a script or attachment as the target of INSERT or DELETE, a REMOTE statement that reads an attachment, a reference outside of a query (`delete ... using
:foo`), a referenced script that is no single SELECT or does not parse ("foo.sql is no single SELECT that bar.sql
could read"), a call that writes or is explained, a call that a query of its own connection would inline, a cycle, a REMOTE statement that reads another connection, a statement that reads a script of another
connection that runs only on request (`@manual`), a view over a materialized result, also
through an inlined query, an inlined query that reads a relation that the statement defines as common table expression
where the query goes (a recursive WITH, the WITH of an INSERT around it), and a materialized script that runs later in the session than the statement that scans it ("move foo.sql above bar.sql").
An inlined script may be below its consumer.

## Inputs

A named scalar parameter `:min` is an input of the session (`session_inputs.md`). Its value is a literal in the Hyper
dialect. The planner binds the inputs of every statement it plans and of every query it inlines: the text of the
parameter becomes the literal printed in the dialect of the connection (`PlannerConnection.dialect`), `INTERVAL '3' DAY`
on Trino for `interval '3 days'`. A script binds the value of its own `@param` tag and the value of the first tag in
session order otherwise. An input without a value and a literal that the dialect can't express are errors with the
span of the parameter, also in a plan of targets. The signature of a script is its AST signature followed by the
literals it binds in the Hyper dialect, `:min=10` per line.

## Conflicts

For each qualified relation name, the planner remembers its last writer and the
readers since that writer. A read depends on the last writer. A write depends on
that writer and outstanding readers. DDL participates in the same conflict timeline, with
distinct DDL edge reasons. Repeated accesses within one statement are merged;
there are no self-edges for INSERT or DELETE statements reading their own destination.

Conflict grouping uses internal `(database, schema, name)` tuples so DROP and
recreation share a timeline without conflating their published entity identities.
CREATE, subsequent accesses, and DROP refer to the live declaration's catalog ID;
recreation has a distinct catalog ID, even within one script. Earlier accesses are
not rebound to the recreated declaration merely because refreshed analysis finds
that declaration. Repeated accesses to the same identity are merged, but a
statement reading an old declaration and creating a same-name new declaration
retains both identity accesses. Only conflict tracking merges those accesses by
qualified name, using the strongest mode.

DROP resolves against the live namespace, not future input declarations. An
unresolved DROP records an unresolved reference, not a synthetic catalog entity.
References to later producers are diagnosed rather than moving those producers
ahead of session order. CTE bindings are not catalog entities in this graph.

The current supported statement families are SELECT, INSERT, DELETE, EXPLAIN,
CREATE TABLE, CREATE TABLE AS, CREATE VIEW, SELECT INTO, DROP TABLE, and DROP
VIEW. ALTER and the schema statements are barriers. A script may have several outputs, the last output of a script is its
result. INSERT and DELETE
produce output only when their root DML node has RETURNING. Nested DML RETURNING
never overrides the output classification of an enclosing EXPLAIN.

## Explain and Visualizations

EXPLAIN always produces output, preserving its statement type and backend SQL.
Plain EXPLAIN treats all referenced relations as READ, including nested INSERT
and DELETE targets. The analyzer still retains the body's table references and
DML roles. Nested CREATE TABLE, CTAS, CREATE VIEW, and SELECT INTO declarations
are not registered as catalog tables, even when the analyzed script is published;
they cannot become planner producers or resolve later consumers.

Execution-enabled EXPLAIN of SELECT or expressions is supported. Options are
inspected structurally through `EXT_EXPLAIN_OPTIONS` and the generic option
key/value attributes, not by searching the whole SQL text. `analyze` and `analyse`
enable execution unless their argument is an explicit boolean false; missing or
unknown arguments are conservative. `format analyze` (including quoted values)
also enables execution. Any enabling option wins over a disabling duplicate.
Execution-enabled EXPLAIN with a mutating body is a barrier with the warning
`execution-enabled EXPLAIN with a mutating body cannot be safely classified`.
Its nested DML target accesses remain WRITE, so the readers and writers of its
targets are ordered around it. Consumers must not execute any node of an invalid graph.
An ordering barrier alone is not a proof that backend execution, DDL publication,
or session effects are safe.

A SELECT with `@vis` tags (see `vis_comments.md`) is planned like any SELECT. Its
node carries the compiled visualization of the tags; a visualization that fails
to compile is an invalid barrier with no backend SQL. The tags are comments, so
the backend SQL of the node is the plain statement text.

## Conservative Limits

Views are not expanded into underlying declarations yet. Reads and writes through
views, unresolved physical relations, ambiguous references, unsupported statements,
and recognized session/locking/constraint/graph effects such as `GRAPH_TABLE`
create barriers against all earlier and later nodes of their connection. Such
barriers have warnings and run in session order, they don't invalidate the graph.
Stale inputs and malformed SQL invalidate it.

This is relation-level planning, not a proof of arbitrary SQL side effects.
Opaque function effects, triggers, backend search-path behavior, and transaction
semantics require additional knowledge. A barrier alone does not guarantee
backend session affinity. TypeScript scheduling and connector admission limits
remain separate work; notably, one embedded Hyper connection cannot execute
concurrent operations.

## Tests

Planner snapshots contain ordered named scripts, optional external catalog SQL,
and expected native text versions, catalog revisions, entities, unresolved
references, nodes, accesses, edges, and diagnostics. A fixture may declare
connections (`connections: [{name, kind, catalog}]`, every script then names its
`connection`), target scripts (`targets: [bar]`), provided materializations
(`materialized: [foo]`) and a tolerant plan (`scope: tolerant`); without connections the scripts run on one implicit
REMOTE connection with the top-level `catalog`. The mount prefix of snapshots is
`/mnt/external/dashql-run-test`. Fixtures with connections print the connection of
scripts, nodes and unresolved references, and prefix entity ids with the
connection name (`trino/256.65536.4294967296`), since catalog ids of different
connections may be equal. Every snapshot prints the cacheability, terminal
statement, signature and references of the planned scripts, the materializations
and the script references with the text of their parameters. Node identifiers are
structured: `id` is the graph-local node index, `script` is the fixture script
name, and `statement-id` is the zero-based statement index. Edge `from`/`to` and
diagnostic `node` fields refer to numeric node IDs. The same preparation and
encoding helper serves generation and comparison, including a repeated encoding
check for deterministic output.
Fixtures do not inject independent document revisions or default versions; script
`text-version` and `analyzed-text-version` come from native preparation and agree
for valid snapshots. Unit tests also round-trip versions above `2^32` through the
wire schema and reject stale script snapshots without executable partial plans.

Every entity and unresolved reference is emitted in graph vector order. TABLE
snapshot IDs follow the analyzer's quoted `database-id.schema-id.object-id`
notation. Other categories use a type-prefixed ID; DATABASE uses `object_id`,
SCHEMA uses `object_id.sub_object_id`, COLUMN appends its column sub-ID to the
qualified object ID, and remaining categories use the qualified object ID with
any nonzero sub-ID. The type discriminator prevents cross-category collisions.
These display IDs are not the wire's vector indices or a replacement wire format.
Names appear once per entry as dotted SQL identifiers, quoting and escaping each
component when necessary and omitting empty qualifiers. Accesses and edges print
the quoted entity display ID or a numeric unresolved-reference vector index:

```yaml
entities:
  - catalog-id: '256.65536.4294967296'
    type: TABLE
    name: db.s.a
  - catalog-id: '256.65536.8589934592'
    type: TABLE
    name: db.s.a
unresolved-references:
  - name: 'db.s."Missing.Name"'
# A CREATE after DROP uses the second identity, but shares the name timeline.
accesses:
  - entity: '256.65536.8589934592'
    mode: DDL
  - unresolved-reference: 0
    mode: READ
```

Fixtures cover cross-script, same-script, and external-catalog DROP/recreation
identities, preserved DDL hazards, unresolved names without catalog entities, and
qualified identifiers containing dots, quotes, keywords, or case-sensitive text.

`planner_validation_hyper_test` executes every valid plan with script references in
Hyper: a database per connection with the catalog of the connection, the SQL of the
nodes in node order, and a `COPY ... TO ... WITH (format => 'parquet')` for every
materialization into a temporary directory that stands for the mount prefix. A
fixture with `hyper: skip` is left out (Hyper rejects `SELECT INTO`).

```bash
bazel run //snapshots/planner:update
bazel test //packages/dashql-core-session:planner_snapshot_test //packages/dashql-core-session:planner_validation_hyper_test \
    //packages/dashql-core-session:dashql_core_session_unit_tests
bazel test //packages/dashql-core-js:all //packages/dashql-core-js/test:all
```
