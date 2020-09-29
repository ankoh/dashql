DECLARE PARAMETER "Weather file" AS weather_file TYPE FILE;

LOAD weather_csv FROM FILE $weather_file;

EXTRACT weather FROM weather_csv USING CSV;

QUERY temperature_daily AS
SELECT
    CAST(CONCAT(year, '-', month, '-', day) AS DATE) as date,
    MIN(temp_min) AS temp_min,
    MAX(temp_max) AS temp_max,
    AVG(temp) AS temp
FROM (
    SELECT
        YEAR(date) AS year,
        MONTH(date) AS month,
        DAY(date) AS day,
        temp_min,
        temp_max,
        temp
    FROM weather
) AS weather
GROUP BY year, month, day
ORDER BY date ASC;

QUERY temperature AS
SELECT
    date as "Date",
    temp_min as "Minimum",
    temp_max as "Maximum",
    AVG(temp) OVER (ORDER BY date ROWS BETWEEN 45 PRECEDING AND 45 FOLLOWING) AS "90-day average"
FROM temperature_daily
WHERE date >= (SELECT CAST(date AS DATE) FROM weather ORDER BY date DESC) - 3 * 365;

QUERY weather_by_month AS
WITH weather_monthly AS (
    SELECT
        MONTH(date) AS month,
        weather
    FROM weather
),
weather_observations AS (
    SELECT
        COUNT(month) AS observations,
        weather,
        month
    FROM weather_monthly
    GROUP BY month, weather
    ORDER BY month ASC, weather ASC
),
weather_observations_total AS (
    SELECT
        month,
        SUM(observations) AS total
    FROM weather_observations
    GROUP BY month
    ORDER BY month
),
months AS (
    SELECT * FROM (
        VALUES
            (1, 'Jan'),
            (2, 'Feb'),
            (3, 'Mar'),
            (4, 'Apr'),
            (5, 'May'),
            (6, 'Jun'),
            (7, 'Jul'),
            (8, 'Aug'),
            (9, 'Sep'),
            (10, 'Oct'),
            (11, 'Nov'),
            (12, 'Dec')
    ) as months(month, name)
)

SELECT
    m.name AS "Month",
    observations * 1.0 / total AS "Share",
    weather as "Weather"
FROM weather_observations o, weather_observations_total t, months m
WHERE
    o.month = t.month AND
    o.month = m.month
ORDER BY o.month ASC, weather ASC;

QUERY temperature_humidity AS
SELECT
    temp as "Temperature",
    humidity as "Humidity"
FROM weather
ORDER BY RANDOM() LIMIT 500;

VISUALIZE "Weather Data (Table)" FROM weather USING TABLE;

VISUALIZE "Weather Monthly (Table)" FROM weather_monthly USING TABLE;

VISUALIZE "Temperature (Table)" FROM temperature USING TABLE;

VISUALIZE "Temperature (Line Chart)" FROM temperature USING LINE;

VISUALIZE "Weather Observations (Table)" FROM weather_observations USING TABLE;

VISUALIZE "Weather Observations (Stacked Bar Chart)" FROM weather_observations USING BAR;

VISUALIZE "Weather Observations Total (Table)" FROM weather_observations_total USING TABLE;

VISUALIZE "Weather Observations Total (Bar Chart)" FROM weather_observations_total USING BAR;

VISUALIZE "Weather by Month (Table)" FROM weather_by_month USING TABLE;

VISUALIZE "Weather by Month (Stacked Bar Chart)" FROM weather_by_month USING BAR;

VISUALIZE "Temperature and Humidity (Table)" FROM temperature_humidity USING TABLE;

VISUALIZE "Temperature and Humidity (Scatter Plot)" FROM temperature_humidity USING SCATTER;
