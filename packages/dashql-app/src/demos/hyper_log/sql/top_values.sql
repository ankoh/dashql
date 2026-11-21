/* The largest values */
SELECT id, category, value
FROM workload_events
ORDER BY value DESC, id
LIMIT 20
