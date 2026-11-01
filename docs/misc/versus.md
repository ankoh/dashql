
### Incremental parsing with Tree-sitter?

Tree-sitter is a great parser framework and I recommend everyone to try it out.
It gives you flexible incremental parsing without much hassle and is a perfect fit for many editors.

DashQL was built for specific database systems.
The systems Hyper, Umbra, NoisePage, AlloyDB and DuckDB all use Bison parsers derived from the PostgreSQL grammar.
The PostgreSQL grammar stood the test of time and established itself as de-facto reference for SQL syntax.
Staying close to PostgreSQL simplifies building frontends for these database systems without worrying too much about grammar differences.
DashQL builds around a carefully optimized and very fast parser based on the PostgreSQL-grammar and provides lightweight semantic analysis passes, running on every single keystroke.

DashQL is still doing work in `O(text-length)` with every input event, as opposed to `O(change-size)` by Tree-sitter.
Yet, DashQL analyzes most input in well under a millisecond in your browser, even when replacing the entire text.
After all, the parser is not the only component that has to be tuned for fast analysis passes, incremental parsing alone "only" gives you a head-start for the AST update.
DashQL keeps the text in a B-tree rope, dictionary-encodes and tags SQL object names in-flight and performs efficient post-order DFS traversals through linear scans over a compact AST representation.

---

### What does "fast" mean in numbers?

Here are timings for TPC-DS Q1, natively and single-threaded on an AMD Ryzen 7 9850X3D (WSL2).
DashQL spends **3us** with scanning, **9us** with parsing, and **11us** with analyzing, leaving plenty of time for Javascript to reflect changes in the UI.
Each line is the median time per iteration of 21 batches, from `bazel run -c opt //packages/dashql-core:bench_pipeline`:

```
scan_text                        2402 ns
parse_driver_only                8818 ns
scan_parse_query                11453 ns
attrs_21/5                          4 ns
attrs_21/21                        15 ns
attrs_21/40                        19 ns
scan_query                       2568 ns
parse_query                      8918 ns
analyze_query                   11313 ns
analyze_query_only              10950 ns
format_query                     6831 ns
move_cursor                        90 ns
complete_cursor                573324 ns
```

