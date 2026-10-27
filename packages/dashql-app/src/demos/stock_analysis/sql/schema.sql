-- The trades of the live board, one row per trade with the best bid and ask at its time.
-- A remote Hyper serves the same table, filled by an ingester of its own.
create table if not exists ticks (
    symbol text not null,
    ts timestamptz not null,
    price double precision not null,
    size double precision not null,
    bid double precision,
    ask double precision
)
