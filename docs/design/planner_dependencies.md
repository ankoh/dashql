# Planner Dependencies

The planner (`planner.md`) turns the statements of a session into a DAG of nodes and edges. This document describes
which statements become nodes, which edges connect them, and what a run of the session and a run of one script
execute. Script references, their splicing and their errors are described in `script_references.md` and in the
Script References section of `planner.md`, the wire format and the API in `planner.md`. The code is `plan_session`
in `packages/dashql-core-session/src/planner.rs` and `ScriptReferences` and `splice_statement` in
`packages/dashql-core-session/src/script_references.rs`.

## Nodes

A node is a statement. Node ids follow session order, the order of the scripts in the request, and within a script
the statement order (`plan_session` numbers the included statements script by script). Every edge points from a
lower to a higher node id, so the node order is a topological order; `runExecutionGraph` rejects a plan that breaks
it.

A node records:

- `sql`: the statement text with its script references spliced in (`splice_statement`), also for barriers with
  effects the planner cannot classify (unsupported statement types, EXPLAIN without a body, execution-enabled EXPLAIN
  with a mutating body). A visualization that fails to compile clears it.
- `produces_output`: SELECT and EXPLAIN always, INSERT and DELETE with RETURNING on their root, nothing else; SELECT
  INTO does not (`produces_output` in `compiler.rs`).
- `script_result`: the node is the terminal statement of its script, the last statement (`Prepared::terminal`), and
  it produces output. A script that ends with a command has no `script_result` node, neither has a script whose
  terminal statement is not in the plan.
- `materialization`: set on the `script_result` node of a script whose result an included statement of another
  connection scans; the node writes its result to the path of the materialization.
- `inputs`: the materializations the statement scans, through its own references and through the queries
  of the scripts it inlines.
- `inlined_scripts`: the scripts whose queries the statement inlines as common table expressions, also those that
  inlined queries reference, in the order of the common table expressions.
- `accesses`: the relations the statement reads (READ), writes (WRITE) or defines and drops (DDL), one access per
  entity or unresolved reference with the strongest mode, READ < WRITE < DDL.
- `barrier`: the node is ordered against every node of its connection (Barriers).

The app takes the last node of a script in the plan that produces output as the output of the script
(`runExecutionGraph`): it analyzes and publishes its result and registers it as the result of the script. That node
is not necessarily the `script_result` node.

Every query of a node carries where the statement comes from (`QueryMetadata.planned`, `describePlannedStatements`):
the run, the node, the script and the position of the statement among the statements of the script in the plan, the
inlined scripts, the materialized results it scans, the file it writes and the edges it runs after. The query history
shows it as title, e.g. `bar.sql 1/1 · inlines foo.sql · scans base.sql`, and description. The log target
`session_execution` records the plan before it runs, every statement with its query id, the materialized results
that are written, the cached results that a run reads instead of running a script, and the statements that fail.

## Scopes

A plan of the session (`PlanScope::Session`) prepares and checks every script, also those whose materialized results
the host provides (`SessionPlanRequest.materialized`). Every script must have a current analysis and parse, syntax
errors invalidate the plan. It includes every statement of the scripts whose results the host doesn't provide; a
scan of a provided script reads its file, an inline reference to it still splices its query.

A plan decides per script how much it includes (`Include`), starting from the scripts it includes in full (`seeds`,
`ExecutionGraphScript.target`): the targets of a plan of targets (`PlanScope::Targets`), the scripts without provided
results of a plan of the session, every script of a tolerant plan (`PlanScope::Tolerant`, the plan of the dataflow,
see `planner.md`).

| Include | Statements |
|---|---|
| `All` | every statement |
| `Inlined` | none, the query of the script is inlined into its consumers |
| `None` | none |

These scripts are `All`. A script that is `Inlined` or `All` passes its references on: an inline reference makes the
referenced script at least `Inlined`, a scan reference makes it `All` unless the host provides its result. A
referenced script is a single SELECT, so `All` adds one node to the plan. Levels only grow, so a script that is inlined
by one script and materialized by another is `All`. Every other script is `None`: it has no node, even if it writes
relations that an included statement reads.

In a plan of targets, the scripts that must have a current analysis are the targets and every script they reference, transitively and
whatever the reference becomes (`ExecutionGraphScript.planned`), so a script whose provided result is scanned needs a
current analysis and its references are checked, although it has no nodes. A plan of targets runs like a single
script: a target that does not parse is one barrier node with its text as written, `produces_output` and
`script_result` and no accesses ("the script does not parse, it runs as written"); statement diagnostics
(`PlanState::diagnose`) are warnings. Stale analysis, reference errors, the "runs later" error and visualizations
that don't compile stay errors. A referenced script that does not parse is the error "is no single SELECT", so only
targets become such opaque nodes.

## Edges

An edge points from a prerequisite to a dependent. The reasons of `ExecutionGraphEdgeReason` in
`proto/fb/dashql/execution_graph.fbs`:

| Reason | Created by |
|---|---|
| READ_AFTER_WRITE | a READ after the last WRITE of the relation |
| WRITE_AFTER_READ | a WRITE after the reads since the last write |
| WRITE_AFTER_WRITE | a WRITE after the last WRITE |
| DDL | any of the three above when the access or the last writer is DDL (see below) |
| BARRIER | a barrier node and the nodes of its connection |
| MATERIALIZATION | the node of a materialized script and the statement that scans its result |
| SEQUENCE | consecutive nodes of one script in a plan of targets |

Conflict edges carry the entity or unresolved reference of the dependent's access, the other edges carry neither.
Edges are a set of `(from, to, entity, unresolved reference, reason)`, so one pair of nodes can have several edges;
`runExecutionGraph` counts a pair once. There are no self-edges.

### Relation Conflicts

Every connection has its own timelines, one per qualified relation name `(database, schema, name)`. Nodes are visited
in node order, the accesses of a node are first merged by name with the strongest mode. A timeline keeps its last
writer, the mode of that writer, and the readers since that writer:

- READ: an edge from the last writer, reason DDL if the writer's access was DDL, READ_AFTER_WRITE otherwise. The node
  joins the readers.
- WRITE or DDL: an edge from the last writer, reason DDL if either access is DDL, WRITE_AFTER_WRITE otherwise, and an
  edge from every reader since, reason DDL if this access is DDL, WRITE_AFTER_READ otherwise. The readers are cleared,
  the node becomes the last writer.

Readers before the previous writer are ordered transitively through it. A statement that reads its own write target,
`insert into t select * from t`, has one WRITE access and no self-edge. Relations of different connections never
conflict.

DDL accesses come from the target of CREATE TABLE, CREATE TABLE AS, CREATE VIEW, SELECT INTO, DROP TABLE and DROP
VIEW. Accesses name catalog identities, the timeline names: a DROP and a recreation of the same name share one
timeline while their accesses keep distinct entities (`planner.md`, Conflicts). The planner tracks a live namespace
per connection while it visits the statements: the declarations of participating scripts enter it at their CREATE,
those of every other script of the catalog are in it from the start, a DROP removes the name. A direct read of a
dropped name is a barrier, and so is a direct read of a relation whose producer is the same node or a later one
("relation resolves to a later producer in input order").

### Barriers

A node is a barrier if one of its checks fails: unsupported statement types, unsupported table sources, ambiguous
relations or DROP targets, incompatible declarations, reads of dropped relations, reads of later producers, missing
DDL targets, session, locking, constraint or graph effects (reported once per statement), mutating
execution-enabled EXPLAIN, analyzer errors, unresolved relations, unresolved DROP targets, and reads, writes and DROPs
of a view (a view of the catalog or one that a planned CREATE VIEW created), since views are not expanded. The
diagnostics of barriers are warnings in every scope, the statement runs as written in session order. A visualization
that does not compile is an invalid barrier in every scope.

Barriers order the nodes of their connection only. In node order, every node gets a BARRIER edge from the last
barrier of its connection, and a barrier node also gets a BARRIER edge from every node of its connection since the
previous barrier. A barrier thus runs after every earlier node of its connection, directly or through the previous
barrier, and before every later one, directly until the next barrier and through it afterwards.

### Script References

A referenced script is a single SELECT (`ScriptReferences::check`): a script with commands, several statements, a
statement of another kind or a syntax error is the error "foo.sql is no single SELECT that bar.sql could read". A
reference thus never runs a command of the referenced script. A single call of a client function that reads is the
exception that a scan reads (`unreadable`), its node is the terminal node of the materialization.

`splice_statement` resolves the references of a statement into the scripts it reads, every script after the scripts
its query references. Inline references are followed into the query of the inlined script, so a statement also reads
the scripts that the inlined queries reference. For every inlined script the statement records its query (`inlined`),
for every materialized script the materialization (`inputs`).

An inlined query gets no node and no edge of its own, it is part of the statement and takes part in the conflicts
through the reads the statement inherits. A materialized query is the node of its script, MATERIALIZATION is an edge
from it to the statement, if the plan computes the result. A result that the host provides has no node
(`ExecutionGraphMaterialization.node` is absent) and no edge; `runExecutionGraph` pins its file before the run.

A MATERIALIZATION edge whose producer has a higher node id than the statement is not added, it is the error "bar.sql
references foo.sql, which runs later; move foo.sql above bar.sql", also in a plan of targets. Since node ids follow
session order, this happens when a materialized script is below its consumer and the plan computes its result. A
inlined script may be anywhere in the session.

### Inherited Reads

A statement that inlines a script reads the relations of the inlined query, and of every query that query inlines in
turn (`plan_session`, the loop over `inlined`). Each table reference of the query that is no
reference to a common table expression (`is_cte_reference`) becomes a READ access of the consumer, merged with the
consumer's own accesses, and takes part in the conflict timeline like a direct read. Inherited and direct reads
resolve their relation alike (`ConnectionState::resolve`). An unresolved name in the query makes the consumer a
non-invalidating barrier, as a direct read would.

The other checks of direct reads do not apply to inherited reads:

- A view read by the query is a READ access of the consumer but does not make it a barrier.
- A relation whose producer comes later in node order is not diagnosed (see Session Order).
- A dropped relation is not diagnosed.
- Table functions and other sources without a relation are skipped, ambiguous relations are not diagnosed.
- A resolved name whose declaration is unavailable or of an incompatible kind is an unresolved-reference access
  without a barrier.
- Every access is READ.

In a plan of the session the node of the inlined script runs these checks itself. In a plan of targets the query of a
inlined script is no node, so nothing checks them.

### Sequence

In a plan of targets every node gets a SEQUENCE edge from the previous node of its script, so the included statements
of a script run in their order, whatever their accesses. Statements of different scripts are not chained, they are
ordered by conflicts, barriers and reference edges only. A plan of the session has no SEQUENCE edges: independent
statements of one script may run side by side.

## Session Order

An inline reference evaluates the query of the referenced script at the position of the consumer, against the
relations as the session order leaves them there. A scan reference reads the result that the node of the
referenced script computed at its own position.

```sql
/* catalog */ create table orders (id int)
/* foo.sql */ select id from orders
/* bar.sql */ select count(*) from :foo
/* baz.sql */ insert into orders values (3)
```

In the order foo, bar, baz, the statement of bar reads `orders` before baz writes it: edges bar → baz and foo → baz
(WRITE_AFTER_READ), the count excludes the new row. In the order foo, baz, bar, baz → bar (READ_AFTER_WRITE), the
count includes it. In the order bar, baz, foo, bar runs before the insert and foo after it, so `:foo` in bar and the
result of foo differ. All three plans are valid.

An inlined script below its consumer is allowed. A materialized script below its consumer is the "move foo.sql above
bar.sql" error unless the host provides its result.

A table that the inlined query reads and that a script between consumer and referenced script creates is not
diagnosed:

```sql
/* bar.sql */ select count(*) from :foo
/* baz.sql */ create table t (x int)
/* foo.sql */ select * from t
```

The plan is valid. bar reads `t` before any writer and joins its readers, the CREATE of baz gets an edge bar → baz
(DDL), so bar runs before `t` is created. foo itself reads `t` after baz. A direct read of `t` in bar would be the
barrier "relation resolves to a later producer in input order".

## Runs of One Script

A run of one script plans the script as the target (`runPlannedScript`): the statements of the target with the
queries it inlines spliced in, and the query of every script it materializes unless the host provides the result, all
transitively. The statements of other scripts are not part of the plan, also those that write relations a
referenced query reads. A run of one script reads the current backend state for those relations; their producers
are outside the plan, so a read of them is never a read of a later producer.

```sql
/* setup.sql */ create table t as select 1 as x
/* baz.sql */   insert into t values (2)
/* foo.sql */   select * from t
/* bar.sql */   select count(*) from :foo
```

A run of the session plans four nodes:

| Node | Statement | Edges in |
|---|---|---|
| 0 | setup: `create table t as select 1 as x` | |
| 1 | baz: `insert into t values (2)` | 0 (DDL) |
| 2 | foo: `select * from t` | 1 (READ_AFTER_WRITE) |
| 3 | bar: `with foo as (select * from t) select count(*) from foo` | 1 (READ_AFTER_WRITE) |

The run creates `t`, baz inserts a second row, foo returns two rows and bar counts 2. foo and bar both read after
baz and run independently of each other. Neither of them serves a cached result: they follow baz, which runs.

A run of bar plans one node, bar: `with foo as (select * from t) select count(*) from foo`. setup and baz are not
part of the plan, the query of foo runs only inside bar. The run counts the rows of `t` as the backend has them,
e.g. 2 after the session run, and fails with the error of the backend if `t` does not exist. Repeated runs of bar
have no side effects.

A plan of targets orders its nodes by conflicts, barriers and MATERIALIZATION edges, and SEQUENCE edges within each
script. A run of a script whose plan has materializations plans twice when the host mounts results: once without
provided results, to compute the result keys, and again with the cached results of reusable keys as provided
(`runSessionPlan`).

One run holds a session at a time (`acquireSessionExecution`), a run of the whole session or of one of its scripts.
The app disables the runs of a held session, a run that starts meanwhile fails. A run of the agent can't see that
the session runs: it waits for the run of another script to end (`waitForSessionExecution`) and fails only while the
whole session runs. A failed
statement cancels the other statements of a run, and the run settles once they are done, before it releases the files
of its materializations.

## Cacheability

A script is cacheable if it parses, has a statement and every statement is a SELECT or EXPLAIN
(`ExecutionGraphScript.cacheable`). The scripts it references need no check: a referenced script is a single SELECT or a
call that reads, anything else invalidates the plan. A call isn't cacheable, so the key of a script that reads one isn't
reusable (`query_cache.md`). Whether a cached result is used also depends on the connections
(`query_cache.md`, Cache Key).

## Outputs of a Target

A target may have several outputs. The last node of a script in the plan that produces output is its output
(`runExecutionGraph`), e.g. the SELECT of `select 1; create table t (a int)`, while `script_result` marks only a
terminal statement that produces output. Referenced scripts have a single statement, so their output and their
`script_result` node are the same.
