# Workbook Inputs

The named scalar parameters of the scripts of a workbook are its inputs. `:min` and `:span` in

```sql
/**
 * @param :min = 10
 * @param :span = interval '3' day
 */
select * from orders where amount > :min and ts > now() - :span;
```

are the inputs `min` and `span`. The feed and the dashboard show the inputs as cards at their top, the dataflow draws
every input as a box with edges to the statements that use it. A changed value runs every script that the change
affects.

## Inputs

`session_inputs::collect_session_inputs` (`dashql-core-runtime`, core-js `collectSessionInputs`) collects the inputs of
the scripts of a workbook whose analysis is current with their text, one per name, in the order of their first use. A
table parameter (`from :foo`, `script_references.md`) and a positional parameter (`$1`, `?`) are no inputs. A scalar
parameter `:foo` is an input also if a script `foo.sql` exists.

An input has:

- **A value.** The literal of the first `@param` tag of the name with a value in workbook order, unset if there is none.
- **A type.** The type of a cast of the parameter, `:min::int` or `cast(:day as date)`, the first cast in workbook order,
  otherwise the type of the literal: `bigint` for an integer, `numeric` for a decimal, `boolean`, `text`, `date`,
  `time`, `timestamp` or `interval`. Casts to different types are a warning. An input without a cast and without a value
  is text. The analyzer reads the type of a cast as a structured type (`analyzer::sql_types`, `SqlType` in
  `analyzed_script.fbs`), the kind (`INT4`, `NUMERIC`, `TIMESTAMP`, a `GENERIC` name, ...) with its precision, scale,
  length, time zone and array dimensions. The names of well-known types map to their kinds, `::int8` and `::bigint` are
  one type, and so is `::pg_catalog.int8`. Another qualified name keeps its schema, `::myschema.mytype`.
- **Its consumers.** The statements that use the input.

## The `@param` Tag

The value of an input is a comment tag (`core_parser.md`, Comment Tags) of every script that uses it:
`@param :name = <literal>`. The parameter is written like in the query, double-quoted if it is no plain word
(`@param :"foo 2" = 'x'`). `@param :min` leaves the input unset. Like `@flow` the tag annotates any statement of the
script, the first tag of a name in statement order wins, a second one is a warning (`INVALID_PARAM_TAG`). The analyzer
collects the tags in `AnalyzedScript.param_values` (`analyzer::param_tags`).

The value is a literal in the Hyper dialect, whatever the connection of the script speaks (`sql_literal`): a number
(`10`, `-2.5`), a string (`'EU'`), `true`, `false`, `null`, or a typed literal (`date '2024-01-01'`,
`timestamptz '2024-01-01 10:00+02'`, `interval '3' day`). The parser of DashQL reads it as the expression of
`select <literal>`, the reader of types of the analyzer (`analyzer::sql_types`) reads the type of a typed literal and
the formatter prints it. Anything else, e.g. `now()` or `1 + 1`, is a warning on the tag and leaves the input unset.
Scripts never hold the literals of another dialect, so DashQL never reads them.

An interval is a number and one unit, `year`, `month`, `day`, `hour`, `minute` or `second`: an integer, seconds may
have a fraction (`interval '1.5' second`). Hyper and Trino read it alike. Interval text, `interval '3 days'` or
`interval '1 day 2 hours'`, is no literal: Trino has no form of it, and DashQL doesn't read the text of intervals. The
unit is part of the value, the type of an input with an interval literal is `interval`.

`param_rewrite::rewrite_param_tag` (`ScriptSession.rewriteParamTag`, `removeParamTag`) writes a literal: the first tag
of the name is replaced where it is and the others are removed. Without a tag a new one goes into the annotation of the
statement that uses the input first, after its other `@param` tags and before its `@vis` tags. A script binds the value
of its own tag and the value of the workbook otherwise. The app writes a value into every script that uses the input, so
the scripts agree and every script holds its values on its own, also when it is exported.

## Binding

The planner binds the inputs of every statement it plans and of every query it inlines: the text of a parameter becomes
the literal printed by the formatter in the dialect of the connection of the statement (`SqlLiteral::print`,
`PlannerConnection.dialect`, which the app derives from the connector like the formatter). A negative number is put in
parentheses, `x-:n` would read as a comment otherwise.

| Literal | Hyper | Trino |
|---|---|---|
| `10`, `-2` | `10`, `(-2)` | `10`, `(-2)` |
| `'it''s'` | `'it''s'` | `'it''s'` |
| `date '2024-01-01'` | `date '2024-01-01'` | `date '2024-01-01'` |
| `timestamptz '2024-01-01 10:00 UTC'` | `timestamptz '2024-01-01 10:00 UTC'` | `timestamp '2024-01-01 10:00 UTC'` |
| `interval '3' day` | `interval '3' day` | `interval '3' day` |

The Trino dialect of the formatter writes the literals of the Hyper dialect that Trino reads differently: Trino reads
the time zone of a timestamp or time literal from its text, so the type of the literal has no zone.

A cast of the parameter in the query applies to the literal, `:min::int` with `'10'` is `'10'::int`. An input without a
value and a literal that the dialect can't express are errors of the plan, with the span of the parameter
(`input :min has no value`). A run of the script fails with them.

The signature of a planned script (`ExecutionGraphScript.signature`) is its AST signature followed by the literals it
binds in the Hyper dialect, `:min=10` per line in name order. The result key of a script follows its values, and the
keys of the scripts that reference it follow it (`workbook_results.md`).

## Running

`setWorkbookInput` writes the value into the scripts that use the input. A mounted editor applies the rewrite as a
change (`ScriptData.externalChanges`), it keeps its cursor and undoes it as one step.
`useApplyWorkbookInput` then starts a run of the workbook with `inputs` (`runWorkbook` of the runtime): the run analyzes the
scripts, derives the dataflow and plans the scripts that the change affects as targets (`affected_scripts` in `workbook_run/plan.rs` of the core runtime), the
scripts that use one of the inputs and every script downstream of them by an inline, scan or table edge, except the
scripts that run only on request (`@manual`, `DataflowScript.manual`); the scripts downstream of them are targets. The targets
run with what they read, the scripts they scan are served from their stored results when their keys are reusable.
A change that no script reads runs nothing. A run that holds the workbook stops, the run of the change starts once the
workbook is free, with the inputs of every change since. The `run` slice of the workbook names the inputs whose change
waits (`pendingInputs`) and those whose change waits or runs (`busyInputs`, the inputs of the run that holds the
workbook and the pending ones): every control of an input, in the strip, the overlay and the dataflow, shows it busy
from the change until the run that applies it ended.

## The App

The runtime collects the inputs of a workbook with the planner (`planner/session_inputs.rs`) in the derived view of the
workbook, which moves when they change; `readWorkbookInputs` (`workbook/workbook_inputs.ts` of the platform of
`@akohn/dashql`) reads them. `WorkbookInputCard` shows an
input: the name, the type and a control that follows the type, a number field, a boolean select, a date or a datetime
field, a number field with a unit select for an interval, and text otherwise. The control shows the value without its
SQL, `3` and `day` for `interval '3' day` and `EU` for `'EU'`. The control owns its draft: a typed draft that rests
for a moment (`WORKBOOK_INPUT_COMMIT_DELAY_MS`) is written and runs, Enter and leaving the control write it at once,
Escape restores the value, a changed unit or boolean writes it at once. The core makes the literal of a draft (`inputLiteral`, `SqlLiteral::from_value`): the type of the input says
what the draft is, an input whose type is unknown reads a number, `true`, `false` or a string. A draft that the type
doesn't read, e.g. `ten` for an integer or `1.5` hours, is marked and not written.

- **Feed and dashboard.** `WorkbookInputStrip` puts the cards in the section "Parameters" at the top of the view. The
  views are boards: every section stands on the stage without a bar, its label written above it (`StageSection`). In
  the feed the parameters and the attachments are the head of the document: they stand above the first script and
  scroll away with the scripts (a child of the list, the first row leaves their height free, `topInset` of
  `FeedRowHeightCache`). The head ends with the label "Scripts", the first script stands below it like the content of
  a section (`feedTopSpace`). A section shows only with content, "Parameters" with at least one parameter. On the
  landing view of an empty workbook they stand above the greeting. The dashboard has the sections "Parameters",
  "Scripts" (the scripts without a visualization) and "Visualizations", they scroll alike. The inputs belong to the
  scripts, not to the prompt, so they stay apart from it. The docked prompt floats over the bottom of the feed with a
  shadow and stands out of the scripts by the same width left and right, the cards of the scripts lie flat.
- **Parameters in the scripts.** A click on a scalar parameter in the editor of a script in the feed opens its input in
  an overlay below the parameter (`WorkbookInputOverlay`), the same card as in the strip, so an input that scrolled
  away stays at hand. The overlay follows the parameter while the feed scrolls and closes once it is out of view. A
  click on a table parameter, `from :orders`, brings the card of the referenced script into view and selects it. The
  core names the parameter under the cursor that the click placed (`parameter` of the cursor context of an editor
  update), `DashQLParameterClickPlugin` only checks that the click hit its text; a click beside it, a double click or a
  click with a modifier only places the cursor.
- **Draft inputs.** The prompt shows the inputs of its SQL draft on its header bar, below the bar of Wobble, as soon
  as the draft holds a parameter (`collectDraftInputs`), on the landing view and on the docked prompt. A value is written
  into the draft as `@param` tag like in a script and nothing runs, the tag goes along when the draft is sent. A
  question has no inputs, `:name` references a script there.
- **Dataflow.** Every input is a box with a header and the value in one row (`dataflow.md`).
