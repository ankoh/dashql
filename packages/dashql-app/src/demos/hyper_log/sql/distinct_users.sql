/* The users per category, an exact distinct count */
SELECT category, count(DISTINCT user_id) AS users
FROM workload_events
GROUP BY category
