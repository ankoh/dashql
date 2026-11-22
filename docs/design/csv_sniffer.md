# CSV Sniffer

`@akohn/csv-sniffer` (`packages/csv-sniffer`) imports CSV files of any size in the browser: it samples a file for its
format and schema, and converts it to Parquet files with temporary workers, one per range of the file. Hyper, or any
other reader, reads the parts as one table with a `UNION ALL` query. It is a package of its own, independent of DashQL
and of hyperdb-wasm: a Rust crate, its Wasm module and a TypeScript wrapper. It is the first step of a client
capability that attaches CSV files to a workbook as Parquet. For now the CSV Import tool (`tools.html#/csv`,
[tools.md](tools.md#csv-import)) uses it.

Hyper has a CSV reader, but it infers no schema of a CSV file ("EXTERNAL scan of type csv cannot have its schema
inferred"). The package can also write the query that reads a file with that reader (`selectQuery`, see "Reading with
Hyper"), after a scan of the whole file.

## The steps

1. **Sample.** `CsvSniffer.sample` finds the format in the first MiB of the file: the encoding, the dialect
   (delimiter, quote, header), the number of columns and where the data starts. It classifies the values of the first
   MiB and of up to 16 windows of 256 KiB spread over the rest of the file (they cover a file of up to 5 MiB); a window
   drops its first and last record, which it cuts, and records with another number of fields, since it may start in
   quoted text. The result is the schema of the sample with a preview of the first 50 rows. It takes milliseconds for
   a file of any size.
2. **Convert.** `CsvSniffer.convert` splits the data into ranges of at least 16 MiB, one per worker (the cores of the
   machine but one, at most 8), and starts a temporary worker per range. Each converts its range into a Parquet file
   of its own in a folder of the origin private file system and goes. A file that is no UTF-8 is one part: the decoder
   reads it from its first byte.
3. **Read.** `CsvConversion.unionQuery(paths)` reads the parts as one table, in the order of the file.

## Ranges in parallel

A range starts anywhere in the file, also in the middle of a record or of quoted text (`src/convert.rs`):

- **Records.** The reader of a part starts at the byte before its range and drops the first record it reads: that
  record ends at the first line break at or after the byte before, and the part before ends with it. A part ends with
  the first record that ends at or after the end of its range. A record ends at `\n`, at `\r\n` after its `\n`, or at
  a `\r` that no `\n` follows, so a reader that starts in the middle finds the same ends as one from the start.
- **Quotes.** Every quote switches between quoted and unquoted text, also in the middle of a field, like the CSV
  reader of PostgreSQL: whether a byte is quoted depends only on the parity of the quotes before it. Each part guesses
  that its range doesn't start in quoted text and counts the quotes from its read start to the read start of the next
  part. When all parts are done, the counts tell the true state of every range (`quoteStates`), and a part with a
  wrong guess is converted again. With real files the guess is right.
- **Types.** A part converts with the schema of the sample. A value that doesn't fit its column (a text in a `BIGINT`
  column, a value the sample missed) stops the writing: the part classifies the rest of its values and returns its
  columns widened to types that all its values fit, then converts again with them. Only that part, and once, since it
  widens every column it needs at once. The parts may end with different types.

`src/convert.rs` tests every split point of a file with quoted line breaks, doubled quotes, `\r\n` and a blank line
against the file in one part.

## The query over the parts

Each part is a Parquet file with the types of its own columns. The query casts a part to the type that all parts fit,
where its own type differs (`ColumnType::join`: a `BIGINT` and a `DOUBLE PRECISION` are `DOUBLE PRECISION`, a `DATE`
and a `TIMESTAMP` a `TIMESTAMP`, a timestamp with and without zone `TIMESTAMPTZ`, everything else `TEXT`):

```sql
SELECT "id", "score" FROM external('/mnt/external/<uuid>.parquet', format => 'parquet')
UNION ALL
SELECT "id", CAST("score" AS DOUBLE PRECISION) AS "score" FROM external('/mnt/external/<uuid>.parquet', format => 'parquet')
```

Hyper reads several Parquet files with `external(ARRAY[...])` as well, but only if their types are the same, and it
lists no folders and expands no wildcards.

## Workers

The workers don't share memory and need no cross-origin isolation: the converter compiles the module once and sends
it to every worker with the `File`, the plan of the conversion (the format and the columns as JSON) and the folder of
the parts. A worker reads its range in chunks of 4 MiB from the `File`, pushes them into the module, writes the
finished bytes of its Parquet file with a synchronous access handle of the origin private file system, and posts its
progress. The memory of a worker stays at a few chunks and a row group (256 Ki rows). The converter then hands out the
part files as `File`s; `CsvConversion.remove` deletes the folder.

A Wasm module whose memory grows triggers a full garbage collection of V8 each time; a worker has a small heap, so
that costs little there. On the main thread of a page with a large heap the same conversion ran ten times slower.

A host without workers or OPFS converts in its own thread with `inThreadRunner` (the tests in Node do).

## The dialect

The dialect comes from csv-nose 1.4.0 by Joel Natividad, adopted in `src/dialect` from the fork of its MIT release
before the license switch (<https://github.com/ankoh/csv-nose>, `packages/csv-sniffer/LICENSE-MIT`, NOTICE). It implements
the Table Uniformity Method of García (2024): every candidate dialect (delimiter, quote, line terminator) parses the
sample, and a score of how uniform the field counts of its rows are and how consistent the types of its columns are
picks the best. It also finds the encoding (UTF-8, the byte order marks of UTF-16, legacy encodings with chardetng),
the header, and a preamble: comment lines starting with `#` and rows before the table, e.g. a title.

What changed from csv-nose:

- The sniffer takes a sample in memory. The reading of files, readers and HTTP, the command line tool and the benchmark
  are gone.
- It scores the dialects on one thread: rayon is gone.
- It keeps the safety lints of a module (no panicking index, unwrap or expect, see
  [dashql_core.md](dashql_core.md#the-rules)): indexes became `get`, a pattern that fails to compile matches nothing.
- std replaces simdutf8, bytecount, foldhash and thiserror; the crates are csv, regex, chardetng and encoding_rs of
  `@core_crates`.

The types that csv-nose infers serve its scores only. The schema comes from the sample.

## The types

A value is classified into the types that can read it (`src/value.rs`), a column keeps the types that all its values
share (`src/schema.rs`), and the converter parses the values with the same code. A column that saw no value is `TEXT`.
Otherwise it takes the first of:

| Type | Values |
|---|---|
| `BIGINT` | Integers in the range of 64 bits, with spaces around them. An integer with a leading zero (`007`, a zip code) is text |
| `DOUBLE PRECISION` | Integers, decimals, exponents, `NaN`, `inf` |
| `BOOLEAN` | `true`/`false`, `t`/`f`, `yes`/`no`, `y`/`n`, `on`/`off`, `1`/`0`; a column of `1` and `0` only is `BIGINT` |
| `DATE` | Valid days as `YYYY-MM-DD`, `YYYY/MM/DD` or `M/D/YYYY`, else `D/M/YYYY` or `D.M.YYYY`; a column of both orders is text |
| `TIMESTAMP` | Those dates (not the day-first ones) with or without a time with `T` or a space, a fraction, `AM`/`PM`; `TIMESTAMPTZ` if a value names a zone (`Z`, `+02:00`, `UTC`), stored in UTC |
| `TEXT` | Everything else |

In Parquet the types are Int64, Float64, Boolean, Date32, Timestamp in microseconds (with the zone UTC for
`TIMESTAMPTZ`) and Utf8, compressed with Snappy (zstd would need C in the module). In a typed column an empty field and
the words for a missing value of csv-nose (`NA`, `N/A`, `null`, `-`, `#N/A`, ...) are NULL; in a text column an empty
field that isn't quoted is NULL and the words are text. A record with fewer fields has NULLs, extra fields are dropped,
blank lines are skipped. A field of a conversion is cut after 16 MiB (64 MiB of a record), and a cut value is text.

The names of the columns are those of the header, trimmed, an empty one as `column_<n>` and a repeated one with a
suffix `_<n>`.

## Speed

A generated file of 1 GiB (14.1 million rows, 8 columns: an id, a price, a boolean, a date, a timestamp, two texts and a
quantity) on a machine with 16 cores, the workers as threads of Node (V8, the release build of the module):

| Workers | Time | CSV per second |
|---|---|---|
| 1 | 8.7 s | 118 MiB/s |
| 2 | 4.8 s | 212 MiB/s |
| 4 | 2.6 s | 400 MiB/s |
| 8 | 1.5 s | 688 MiB/s |
| 12 | 1.2 s | 869 MiB/s |

The sample took 77 ms, the Parquet files have 150 MiB. `bazel run -c opt //packages/csv-sniffer:convert_bench --
<MiB> [<parts>]` measures the steps natively: one core converts about 250 MiB/s.

## Reading with Hyper

The package can also read a file with the CSV reader of Hyper, which needs the descriptor of all columns. That needs a
scan of the whole file (`CsvSniffer.scan`, one thread), since one value far down the file fails a column. The rules of
that reader, checked against hyperdb-wasm:

- **Records.** Hyper reads a blank line as a record, a file with more than one column fails on it ("too few columns in
  input file"), also on blank lines at its end. A record with another number of fields fails the same way.
- **NULL.** An empty field is NULL. A quoted empty field (`""`) is an empty string, and a cast of it to a number fails.
- **Options.** `delimiter`, `quote` (one byte), `header` and `encoding` (only `utf-8` and `utf-16`) apply. There is no
  option to skip lines, to set a date style, or for a comment character; `"null"` (quoted, a keyword) sets one NULL
  string.
- **Casts.** Hyper reads dates in the MDY style, not `D/M/YYYY` or `D.M.YYYY`.

So `selectQuery(path)` reads a typed column with NULL words, quoted empty strings or day-first dates as `TEXT` and casts
it in the select list (`CASE WHEN "amount" IN ('NA', '') THEN NULL ELSE CAST("amount" AS DOUBLE PRECISION) END`,
`to_date("ordered", 'DD/MM/YYYY')`), and the data that Hyper reads starts after the preamble and ends before the blank
lines at the end (`CsvScan.data`, a slice of the file or of its UTF-8). The scan names the rows that Hyper can't read as
problems of the schema: rows with another number of fields, rows that are no valid UTF-8, a quote that is never
closed.

## The package

It is a source package like `@akohn/dashql`: the TypeScript of `ts/` with the glue and the Wasm that Bazel generates
into `wasm/`. Its exports are `.` (`ts/index.ts`) and `./wasm` (the binary).

| Part | Where |
|---|---|
| The crate: dialect, reader, values, schema, scan, conversion, queries | `src/` |
| The bindings: `CsvFileScanner` (sniff, sample, scan, plan of the parts, `selectQuery`), `CsvPartConverter`, `quoteStates`, `unionQuery` | `bindings/lib.rs` |
| The glue and the Wasm (`:glue`): `wasm/csv_sniffer.js` with the URL of its Wasm as `wasmUrl` | `BUILD.bazel` |
| `CsvSniffer`: the compiled module, `sample`, `convert` and `scan`; `CsvSample` | `ts/index.ts` |
| `convertCsv`, `workerRunner`, `inThreadRunner`, `CsvConversion` | `ts/converter.ts` |
| The conversion of one part with its widening, into a sink | `ts/part.ts` |
| The worker entry and its messages | `ts/worker.ts`, `ts/worker_protocol.ts` |
| `readParquetFiles`, mounts Parquet files in the embedded Hyper and runs a query over their paths | `@akohn/dashql`, `platform/hyperdb/hyperdb_parquet_read.ts` |
| The loader of the app | `packages/dashql-app/src/tools/csv/csv_module.ts` |

TypeScript moves the bytes and starts the workers; the module decides the records, the types, the ranges, the quote
states and the queries. Editors find the generated glue through `rootDirs` of the `tsconfig.json` of the package and
the paths of the root `tsconfig.json`; the dev server of the app reads the package from `:dev_srcs`.

## Tests

- `//packages/csv-sniffer:all`: the unit tests of the crate (with the tests of csv-nose; the conversion at every split
  point, widening, the plan of the parts, the queries), the NYC 311 sample of csv-nose (`tests/fixtures.rs`), Clippy
  with the safety lints, rustfmt, the type checks and ESLint of the wrapper, and its tests in Node (`:test`):
  `ts/converter.test.ts` converts files in parts in the thread of the test (seven parts of a file with quoted line
  breaks, a part that widens a column, the windows of a sample) and reads them with hyperdb-wasm through the query
  over the parts; `ts/index.test.ts` and `ts/hyper_read.test.ts` test the scan and the CSV reader of Hyper.
- The tool, see [tools.md](tools.md#csv-import): its page test converts with a real worker into OPFS in Chromium and
  Firefox.

## Not yet

- The attachment of the parts to a workbook.
- Parallel parts of a file that is no UTF-8: a single-byte encoding could be split like UTF-8, UTF-16 at even offsets.
- Decimal commas and thousands separators (`1,5`, `1,234.5`): those columns are text.
- Changing a type or a name before the conversion.
