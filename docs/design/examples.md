# Examples

DashQL has two kinds of examples.

- **Example sessions** (`examples/sessions/<name>/`) are published sessions: SQL scripts with a manifest. The
  app imports one as an editable session from the "Example Sessions" popover. They show the editor and its
  scripts, see `session_publishing.md`.
- **Demos** (`packages/dashql-app/src/demos/<name>/`) are pages of their own, served by
  `demos.html`. They show what the app cannot do yet, such as a dashboard that refreshes live while a feed
  writes into Hyper. Each page brings its own TypeScript and SQL.

A demo can become an example session once sessions can do what the demo does. A live board, for
instance, needs dashboard cards that run their scripts again on an interval.

## Demos

`demos.html` is a single entrypoint that hosts every demo:

```text
packages/dashql-app/
  demos.html                     # the entrypoint, loads src/demos/demos.tsx
  src/demos/
    demos.tsx                    # providers, the index and the route of every demo
    demo_registry.ts             # the demos: id, title, description, load()
    shared/                      # what the demos share
      data_source.ts             # HyperDB WASM of the page or a remote Hyper
      data_source_picker.tsx     # picks the source, takes the link of `hyperd run --ui`
      use_live_query.ts          # runs a query again and again, never two at a time
      sql_template.ts            # `:name` placeholders in the SQL files
    stock_analysis/              # one folder per demo
      stock_analysis_page.tsx    # the default export is the page
      sql/*.sql                  # the queries of the page, imported with ?raw
```

The routes are hashes, `demos.html#/<id>`, so the vite dev server, Cloudflare Pages and the app protocol of
Electron all serve the page without rewrites. Each page is a lazy chunk, so a demo costs nothing until it
is opened.

The host provides the logger, the HTTP client, and the HyperDB WASM of the page (`EmbeddedDatabaseProvider`).
A flavor goes in front of the hash or into the query of the route, `demos.html?flavor=sidp#/<id>` or
`demos.html#/<id>?flavor=sidp`: the host brands the page with it, which also gives the charts the chart
colors of the flavor.
It leaves out the DashQL core and the compute pipeline. Every page load creates a fresh HyperDB instance in
OPFS, so the tables of a demo never touch the sessions of the app.

### Adding a demo

1. Create a folder `src/demos/<id>/` with a page component as its default export.
2. Add an entry to `DEMOS` in `src/demos/demo_registry.ts`.
3. Keep the queries in `sql/*.sql`, and test them against HyperDB WASM in a browser test, like
   `stock_analysis/stock_analysis_sql.test.ts`. The tests catch dialect mistakes before the page shows them.

The build needs no changes: `demos.html` is already an input of vite, and `src/**/*.sql` is in the sources
of the app.

### Data sources

`shared/data_source.ts` hides the Hyper behind `HyperDBSourceDatabase` (`connect()` →
`query`/`execute`/`close`).

- **This browser**: the HyperDB WASM of the page, attached as `hyper`. The demo creates and fills its own
  tables.
- **Remote Hyper**: an HTTP v3 endpoint with a bearer token, e.g. `hyperd run --ui`. The picker accepts the
  printed link, and the same rules apply as for Hyper links (`hyper_links.md`): `http:` is only allowed on
  loopback, and the token is kept in memory only. A remote Hyper is read-only for the demos. Something
  else fills its tables.

A HyperDB WASM connection runs one statement at a time, so a page that writes and reads uses separate
connections. `useLiveQuery` opens one connection per query.

## Stock Analysis

`#/stock_analysis` is a live board of trades.

- **Table**: `ticks(symbol, ts, price, size, bid, ask)`, one row per trade (`sql/schema.sql`). Hyper has no
  materialized views, so the board aggregates the raw trades with `max_by`/`min_by` on every refresh.
- **Feeds** (HyperDB WASM only):
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
  - the tickers every 500ms (`live_board.sql`, last 24 hours; in HyperDB WASM the retention cuts this to 30
    minutes);
  - the price of the selected symbol per second, and the trades per second, every 1s.
  - Each card and the table show the time of their latest query.
- **Remote**: the page expects the table of `schema.sql` and only reads it.
