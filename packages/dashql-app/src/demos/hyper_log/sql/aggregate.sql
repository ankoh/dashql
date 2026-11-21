/* The events per category */
SELECT category, count(*) AS events, avg(value) AS mean_value, max(ts) AS last_event
FROM workload_events
GROUP BY category
ORDER BY events DESC
