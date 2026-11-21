/* A computation without a table */
SELECT sum(i) AS total, avg(i % 97) AS mean_rest
FROM generate_series(1, 1000000) g(i)
