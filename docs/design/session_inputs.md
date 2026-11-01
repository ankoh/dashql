# Session Inputs

The named scalar parameters of the scripts of a session are its inputs. `:min` and `:span` in

```sql
/**
 * @param :min = 10
 * @param :span = interval '3 days'
 */
select * from orders where amount > :min and ts > now() - :span;
```

are the inputs `min` and `span`. The feed and the dashboard show the inputs as cards at their top, the dataflow draws
every input as a box with edges to the statements that use it. A changed value and Enter run every script that the
change affects.

## Inputs

`session_inputs::collect_session_inputs` (`dashql-core-session`, core-js `collectSessionInputs`) collects the inputs of
the scripts of a session whose analysis is current with their text, one per name, in the order of their first use. A
table parameter (`from :foo`, `script_references.md`) and a positional parameter (`$1`, `?`) are no inputs. A scalar
parameter `:foo` is an input also if a script `foo.sql` exists.

An input has:

- **A value.** The literal of the first `@param` tag of the name with a value in session order, unset if there is none.
- **A type.** The type of a cast of the parameter, `:min::int` or `cast(:day as date)`, the first cast in session order,
  otherwise the type of the literal: `bigint` for an integer, `numeric` for a decimal, `boolean`, `text`, `date`,
  `time`, `timestamp` or `interval`. Casts to different types are a warning. An input without a cast and without a value
  is text. The analyzer reads the type of a cast as a structured type (`analyzer::sql_types`, `SqlType` in
  `analyzed_script.fbs`), the kind (`INT4`, `NUMERIC`, `TIMESTAMP`, a `GENERIC` name, ...) with its precision, scale,
  length, time zone and array dimensions. The names of well-known types map to their kinds, `::int8` and `::bigint` are
  one type.
- **Its consumers.** The statements that use the input.

## The `@param` Tag

The value of an input is a comment tag (`core_parser.md`, Comment Tags) of every script that uses it:
`@param :name = <literal>`. The parameter is written like in the query, double-quoted if it is no plain word
(`@param :"foo 2" = 'x'`). `@param :min` leaves the input unset. Like `@flow` the tag annotates any statement of the
script, the first tag of a name in statement order wins, a second one is a warning (`INVALID_PARAM_TAG`). The analyzer
collects the tags in `AnalyzedScript.inputs` (`analyzer::param_tags`).

The value is a literal in the Hyper dialect, whatever the connection of the script speaks (`sql_literal`): a number
(`10`, `-2.5`), a string (`'EU'`), `true`, `false`, `null`, or a typed literal of a date, a time, a timestamp or an
interval (`date '2024-01-01'`, `timestamptz '2024-01-01 10:00+02'`, `interval '3 days'`, `interval '3' day`). The
parser of DashQL reads it as the expression of `select <literal>`. Anything else, e.g. `now()` or `1 + 1`, is a warning
on the tag and leaves the input unset. Scripts never hold the literals of another dialect, so DashQL never reads them.

`param_rewrite::rewrite_param_tag` (`ScriptSession.rewriteParamTag`, `removeParamTag`) writes a literal: the first tag
of the name is replaced where it is and the others are removed. Without a tag a new one goes into the annotation of the
statement that uses the input first, after its other `@param` tags and before its `@vis` tags. A script binds the value
of its own tag and the value of the session otherwise. The app writes a value into every script that uses the input, so
the scripts agree and every script holds its values on its own, also when it is exported.

## Binding

The planner binds the inputs of every statement it plans and of every query it inlines: the text of a parameter becomes
the literal printed in the dialect of the connection of the statement (`SqlLiteral::print`, `PlannerConnection.dialect`,
which the app derives from the connector like the formatter). A negative number is put in parentheses, `x-:n` would
read as a comment otherwise.

| Literal | Hyper | Trino |
|---|---|---|
| `10`, `-2` | `10`, `(-2)` | `10`, `(-2)` |
| `'it''s'` | `'it''s'` | `'it''s'` |
| `true` | `TRUE` | `TRUE` |
| `date '2024-01-01'` | `DATE '2024-01-01'` | `DATE '2024-01-01'` |
| `timestamptz '2024-01-01 10:00 UTC'` | `TIMESTAMP WITH TIME ZONE '…'` | `TIMESTAMP '2024-01-01 10:00 UTC'` |
| `interval '3 days'` | `INTERVAL '3 days'` | `INTERVAL '3' DAY` |
| `interval '1 day 2 hours'` | `INTERVAL '1 day 2 hours'` | `INTERVAL '26' HOUR` |
| `interval '1 year 2 months'` | `INTERVAL '1 year 2 months'` | `INTERVAL '14' MONTH` |

Trino has one unit per interval literal and no interval of both months and days: an interval is printed in the largest
unit that holds it exactly, `interval '1 month 2 days'` is an error. The text of an interval is read like Hyper reads
it: amounts with units (`3 days`, `1.5 hours`, `2 weeks`), a time (`01:30:00`) and `ago`.

A cast of the parameter in the query applies to the literal, `:min::int` with `'10'` is `'10'::int`. An input without a
value and a literal that the dialect can't express are errors of the plan, with the span of the parameter
(`input :min has no value`). A run of the script fails with them.

The signature of a planned script (`ExecutionGraphScript.signature`) is its AST signature followed by the literals it
binds in the Hyper dialect, `:min=10` per line in name order. The result key of a script follows its values, and the
keys of the scripts that reference it follow it (`query_cache.md`).

## Running

`SET_SESSION_INPUT` writes the value into the scripts that use the input. A mounted editor applies the rewrite as a
change (`ScriptData.externalChanges`), it keeps its cursor and undoes it as one step.
`useApplySessionInput` then starts a run of the session with `inputs` (`runSessionExecution`): the run analyzes the
scripts, derives the dataflow and plans the scripts that the change affects as targets (`affectedScriptIndices`), the
scripts that use one of the inputs and every script downstream of them by an inline, scan or table edge. The targets
run with what they read, the scripts they scan are served from the query result cache when their keys are reusable.
A change that no script reads runs nothing. A run that holds the session stops, the run of the change starts once the
session is free, with the inputs of every change since.

## The App

`useSessionInputs` collects the inputs of a session when a script or its analysis changes. `SessionInputCard` shows an
input: the name, the type and a control that follows the type, a number field, a boolean select, a date or a datetime
field, an interval field (`3 days`), and text otherwise. The control shows the value without its SQL, `3 days` for
`interval '3 days'` and `EU` for `'EU'`. The control owns its draft: Enter writes it and runs, Escape restores the
value. The core makes the literal of a draft (`inputLiteral`, `SqlLiteral::from_value`): the type of the input says
what the draft is, an input whose type is unknown reads a number, `true`, `false` or a string. A draft that the type
doesn't read, e.g. `ten` for an integer or `soon` for an interval, is marked and not written.

- **Feed and dashboard.** `SessionInputStrip` floats the cards over the top of the view on a translucent, blurred
  veil that fades out downward, the content scrolls underneath. The feed starts its first script below the strip and
  the strip holds the chip of the attachments, their cards open in a floating drawer below it. The strip of the
  dashboard sticks to the top of the page.
- **Dataflow.** Every input is a box with a header and the value in one row (`dataflow.md`).
