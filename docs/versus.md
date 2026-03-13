
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
DashQL maintains B+-tree ropes, dictionary-encodes and tags SQL object names in-flight and performs efficient post-order DFS traversals through linear scans over a compact AST representation.

---

### What does "fast" mean in numbers?

Here are timings for TPC-DS Q1 on my laptop. All steps run single-threaded on a M1Max.
DashQL spends **5us** with scanning, **9us** with parsing, and **7us** with analyzing, leaving plenty of time for Javascript to reflect changes in the UI.

```
Run on (14 X 24 MHz CPU s)
CPU Caches:
  L1 Data 64 KiB
  L1 Instruction 128 KiB
  L2 Unified 4096 KiB (x14)
Load Average: 5.38, 4.03, 5.53
----------------------------------------------------------
Benchmark                Time             CPU   Iterations
----------------------------------------------------------
scan_query            5204 ns         5204 ns       133098
parse_query           9598 ns         9591 ns        72798
analyze_query         6969 ns         6967 ns        96950
move_cursor            152 ns          152 ns      4523250
complete_cursor        349 ns          349 ns      1991425
```

