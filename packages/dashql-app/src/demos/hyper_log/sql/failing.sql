/* A query that fails, the log ends it as an error */
SELECT 1 / (id - id) AS broken
FROM workload_events
LIMIT 1
