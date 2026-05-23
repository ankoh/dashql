# dashql-core Line Coverage Report

Generated: 2026-05-23
Overall: 10,054 / 13,868 lines hit (72.5%)

## Per-File Coverage

```
   Lines Hit/Total   (  Pct )  Uncov  File
----------------------------------------------
    23/    23       (100.0%)      0  src/analyzer/analyzer.cc
    23/    23       (100.0%)      0  src/formatter/formatter_explain.cc
  1470/  1489       ( 98.7%)     19  src/utils/rope.cc
   216/   221       ( 97.7%)      5  src/view/plan_layout.cc
    41/    42       ( 97.6%)      1  src/script_signature.cc
   214/   221       ( 96.8%)      7  src/view/plan_view_model.cc
   147/   154       ( 95.5%)      7  src/analyzer/identify_column_computations_pass.cc
   101/   106       ( 95.3%)      5  src/analyzer/identify_column_filters_pass.cc
   212/   223       ( 95.1%)     11  src/view/hyper_plan_parser.cc
    35/    37       ( 94.6%)      2  src/formatter/formatter_create.cc
   318/   337       ( 94.4%)     19  src/formatter/formatting_program.cc
   620/   664       ( 93.4%)     44  src/analyzer/name_resolution_pass.cc
   323/   354       ( 91.2%)     31  src/parser/parser.cc
   134/   147       ( 91.2%)     13  src/parser/scanner.cc
    19/    21       ( 90.5%)      2  src/analyzer/pass_manager.cc
    67/    75       ( 89.3%)      8  src/analyzer/identify_function_calls_pass.cc
   109/   127       ( 85.8%)     18  src/formatter/formatter_select.cc
   162/   190       ( 85.3%)     28  src/view/spark_plan_parser.cc
   165/   197       ( 83.8%)     32  src/analyzer/constant_propagation_pass.cc
   166/   200       ( 83.0%)     34  src/parser/parse_context.cc
    67/    81       ( 82.7%)     14  src/parser/grammar/state.cc
   228/   285       ( 80.0%)     57  src/analyzer/analyze_visualization_pass.cc
    39/    50       ( 78.0%)     11  src/parser/grammar/enums.cc
    80/   108       ( 74.1%)     28  src/parser/grammar/tokens.cc
  1258/  1762       ( 71.4%)    504  src/formatter/formatter.cc
    69/    99       ( 69.7%)     30  src/analyzer/analysis_state.cc
   104/   154       ( 67.5%)     50  src/script_snippet.cc
   898/  1360       ( 66.0%)    462  src/analyzer/completion.cc
   127/   193       ( 65.8%)     66  src/visualize/vegalite_parser.cc
   410/   639       ( 64.2%)    229  src/catalog.cc
   109/   174       ( 62.6%)     65  src/script_cursor.cc
    22/    45       ( 48.9%)     23  src/text/names.cc
    26/    58       ( 44.8%)     32  src/parser/grammar/keywords.cc
    99/   254       ( 39.0%)    155  src/formatter/formatter_vis.cc
   151/   434       ( 34.8%)    283  src/visualize/vegalite_generator.cc
   260/   829       ( 31.4%)    569  src/script.cc
    44/   204       ( 21.6%)    160  src/script_registry.cc
    45/   236       ( 19.1%)    191  src/api.cc
    46/   263       ( 17.5%)    217  src/utils/murmur3.cc
     0/    46       (  0.0%)     46  src/script_comparison.cc
```

## Top Offenders by Uncovered Lines

### 1. src/script.cc — 569 uncovered lines

Script lifecycle operations (editing, diffing, applying changes) are primarily
exercised through the TypeScript/WASM integration rather than C++ unit tests.

### 2. src/formatter/formatter.cc — 504 uncovered lines

Uncovered regions (recently added, no snapshot tests):
- Column constraint types and formatting
- Numeric type formatting with modifiers
- CREATE TABLE column options and constraints
- Various type-casting and expression branches

### 3. src/analyzer/completion.cc — 462 uncovered lines

Completion candidate scoring, filtering, and ranking logic for uncommon
expression contexts (subqueries, CTEs, window functions).

### 4. src/visualize/vegalite_generator.cc — 283 uncovered lines

Vega-Lite spec generation for chart types beyond basic bar/line/scatter.

### 5. src/catalog.cc — 229 uncovered lines

Catalog mutation paths (add/drop/alter) and statistics collection that
are exercised via the WASM API but not through C++ tests directly.

### 6. src/utils/murmur3.cc — 217 uncovered lines

Hash function variants (128-bit x64/x86) used by the perfect hash map.
Only the 32-bit variant is exercised by current tests.

### 7. src/api.cc — 191 uncovered lines

FFI entry points not exercised by C++ tests:
- Script text editing (replace, erase, toString)
- Catalog manipulation (add/drop script, statistics)
- Registry operations (add/drop/find)
- Plan view model configuration and loading

### 8. src/script_registry.cc — 160 uncovered lines

Registry lifecycle (add/drop/find scripts, dependency tracking) tested
through integration tests but not unit tests.

### 9. src/formatter/formatter_vis.cc — 155 uncovered lines

`FormatVisEnum` (mark types, field types, scale types) and
`FormatVarargArray` have limited formatter snapshot coverage.

## Suggested Actions

1. Add formatter snapshots for CREATE TABLE with constraints/options/types
2. Add visualize formatter tests exercising mark/field/scale enum branches
3. Add api_test cases for script editing + catalog + registry FFI functions
4. Add vegalite_generator tests for additional chart types
5. Add murmur3 tests for 128-bit hash variants
