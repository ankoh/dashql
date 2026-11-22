# Examples

DashQL shows its examples as **demos** (`packages/dashql-app/src/demos/<name>/`), pages of their own served
by `demos.html`. They show what the app cannot do yet, such as a dashboard that refreshes live while a feed
writes into Hyper, and the components of the UI foundations. Each page brings its own TypeScript and SQL.

## Demos

`demos.html` is a single entrypoint that hosts every demo:

```text
packages/dashql-app/
  entrypoints/demos.html         # the entrypoint, loads src/demos/demos.tsx, served as /demos.html
  src/demos/
    demos.tsx                    # providers, the index and the route of every demo
    demo_registry.ts             # the demos: id, title, description, load()
    shared/                      # what the demos share
      data_source.ts             # the HyperDB WASM of the page
      hyperdb_incremental_extract.ts  # incremental extracts of one Hyper into another, the source type of the demos
      use_live_query.ts          # runs a query again and again, never two at a time
      sql_template.ts            # `:name` placeholders in the SQL files
    stock_analysis/              # one folder per demo
      stock_analysis_page.tsx    # the default export is the page
      sql/*.sql                  # the queries of the page, imported with ?raw
    hyper_log/                   # the metrics of the Hyper log, the former connection overview of the app
    ui/
      ui_page.tsx                # the components of @akohn/dashql-react/components
```

The routes are hashes, `demos.html#/<id>`, so the vite dev server, Cloudflare Pages and the app protocol of
Electron all serve the page without rewrites. Each page is a lazy chunk, so a demo costs nothing until it
is opened.

The host provides the logger, the HTTP client, and the HyperDB WASM of the page (`EmbeddedDatabaseProvider`). Its
Hyper logs the resource usage every second (`engineSettings` of the options of the provider), which the Hyper log demo
reads; the app leaves this out.
A flavor goes in front of the hash or into the query of the route, `demos.html?flavor=dbcom#/<id>` or
`demos.html#/<id>?flavor=dbcom`: the host brands the page with it, which also gives the charts the chart
colors of the flavor. The former id `sidb` selects the same flavor.
It leaves out the DashQL core and the compute pipeline; a demo that needs them brings them in its own chunk, like the
Hyper log demo. Every page load creates a fresh HyperDB instance in
OPFS, so the tables of a demo never touch the workbooks of the app.

### Adding a demo

1. Create a folder `src/demos/<id>/` with a page component as its default export.
2. Add an entry to `DEMOS` in `src/demos/demo_registry.ts`.
3. Keep the queries in `sql/*.sql`, and test them against HyperDB WASM in a browser test, like
   `stock_analysis/stock_analysis_sql.test.ts`. The tests catch dialect mistakes before the page shows them.

The build needs no changes: `demos.html` is already an input of vite, and `src/**/*.sql` is in the sources
of the app.

### Data sources

`shared/data_source.ts` hides the HyperDB WASM of the page behind `HyperDBSourceDatabase` (`connect()` →
`query`/`execute`/`close`), attached as `hyper`. The demo creates and fills its own tables.

A HyperDB WASM connection runs one statement at a time, so a page that writes and reads uses separate
connections. `useLiveQuery` opens one connection per query.

## Stock Analysis

`#/stock_analysis` is a live board of trades.

- **Table**: `ticks(symbol, ts, price, size, bid, ask)`, one row per trade (`sql/schema.sql`). Hyper has no
  materialized views, so the board aggregates the raw trades with `max_by`/`min_by` on every refresh.
- **Feeds**:
  - a seeded random walk of 24 stocks at 100 to 10,000 trades per second, with 5 minutes of history at the
    start;
  - the public ticker channel of Coinbase Exchange (`wss://ws-feed.exchange.coinbase.com`), 22 USD pairs;
  - the public trade and book ticker streams of Binance (`wss://data-stream.binance.vision`, the market data
    host), 20 USDT pairs. A trade carries no quote, it gets the latest best bid and ask of its pair.
  - Neither exchange needs credentials. `WebSocketTickFeed` batches their trades and reconnects with backoff,
    an exchange only brings its url, subscription and message parser (`FeedProtocol`).
  - `TickWriter` inserts the trades in batches every 200ms and deletes trades older than 30 minutes, so the
    table stays bounded. Switching the feed empties the table.
- **Layout**: two cards above the table of tickers. One card shows the trades per second, the other one the
  selected ticker (the busiest one until a row is clicked) with its price per second.
- **Queries**:
  - the tickers every 500ms (`live_board.sql`, last 24 hours; the retention cuts this to 30 minutes);
  - the price of the selected symbol per second, and the trades per second, every 1s.
  - The table shows the time of its latest query.

## Hyper Log

`#/hyper_log` shows the query metrics and the resource usage of the HyperDB WASM of the page from its log. It is the
dashboard that the connection overview of the app showed for Hyper connections; the app starts no monitor of a Hyper
log any more, its reads of the log and its writes ran next to the first queries of every start.

- **Workload**: `HyperLogWorkload` (`hyper_log_workload.ts`) sends the queries of `sql/` round robin, off, 1 or 5 per
  second, at most 4 at a time. The table `workload_events` (`sql/schema.sql`) holds 200,000 events in the user database
  of the page. The queries are attributed to the connection `hyper_log_demo` by their client context
  (`hyperLogClientContext`, kind `user`); `distinct_users.sql` runs like a computation of the app on a pooled
  connection (kind `sqlframe`), and `failing.sql` divides by zero, so the log holds errors too.
- **Monitor**: `HyperLogMetrics` (`hyper_log_metrics.ts`) extracts the log of the HyperDB WASM of the page with a
  `HyperDBIncrementalExtract` and a `HyperDBLogSource` (`hyperdb_log_extract.ts`) every 5 seconds into a monitoring
  database, the query ends whose client context names the connection and the resource samples. It backfills the
  retained log when it opens. The log writes the local time of the page, the queries of the extract turn it into
  milliseconds since the epoch with the time zone offset of the page. The monitoring database lives in an OPFS
  instance folder of the page, which goes with the page. The page passes the monitor to the dashboard as a prop.
- **Dashboard**: `HyperLogDashboard` (`hyper_log_dashboard.tsx`) charts the activity, the latencies, the engine and the
  resource samples, and lists the queries of the extract in a data table of the app (`query_table.tsx`). The table
  analyzes its rows as a computation, so the page instantiates the core (`DashQLCoreProvider`) and runs a
  `StandaloneRuntime` on the HyperDB WASM of the page.
- **Tests**: the workload against HyperDB WASM (`hyper_log_workload.test.ts`), the monitor, the extract, the queries of
  the dashboard and the schema of the resource samples next to them.

## UI Components

`#/ui` shows the components of `@akohn/dashql-react/components` (`packages/dashql-react/src/components`) in their variants and sizes: segmented controls, text
inputs with actions and validation states, buttons and action lists. It runs no queries.
