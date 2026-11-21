/* The events that the workload of the Hyper log demo reads, in the user database of the page */
CREATE TABLE workload_events AS
SELECT
    i AS id,
    'category_' || (i % 12) AS category,
    (i * 7919) % 50000 AS user_id,
    ((i * 31) % 1000)::DOUBLE PRECISION / 10 AS value,
    TIMESTAMP '2026-01-01 00:00:00' + (i % 86400) * INTERVAL '1 second' AS ts
FROM generate_series(1, 200000) g(i)
