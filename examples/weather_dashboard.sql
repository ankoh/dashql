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

QUERY temperature_monthly AS
SELECT
    CAST(CONCAT(year, '-', month, '-', '01') AS DATE) as date,
    MIN(temp_min) AS temp_min,
    MAX(temp_max) AS temp_max,
    AVG(temp) AS temp
FROM (
    SELECT
        YEAR(date) AS year,
        MONTH(date) AS month,
        temp_min,
        temp_max,
        temp
    FROM weather
) AS weather
GROUP BY year, month
ORDER BY date ASC;

QUERY temperature_3_years AS
SELECT
    date as "Date",
    temp_min as "Minimum",
    temp_max as "Maximum",
    AVG(temp) OVER (ORDER BY DATE ROWS BETWEEN 45 PRECEDING AND 45 FOLLOWING) AS "90-day average"
FROM temperature_daily
WHERE date >= (SELECT CAST(date AS DATE) FROM weather ORDER BY date DESC) - 3 * 365;

QUERY temperature_40_years AS
SELECT
    date as "Date",
    AVG(temp) OVER (ORDER BY DATE ROWS BETWEEN 5 * 12 PRECEDING AND 5 * 12 FOLLOWING) AS "10-year average",
    temp as "Monthly average"
FROM temperature_monthly
WHERE date >= (SELECT CAST(date AS DATE) FROM weather ORDER BY date DESC) - 40 * 365;

QUERY weather_monthly AS
SELECT
    MONTH(date) AS month,
    LEFT(MONTHNAME(date), 3) AS month_name,
    weather
FROM weather;

QUERY weather_observations AS
SELECT
    month_name,
    COUNT(month) AS observations,
    weather,
    month
FROM weather_monthly
GROUP BY month_name, month, weather
ORDER BY month ASC, weather ASC;

QUERY weather_observations_total AS
SELECT
    month_name,
    SUM(observations) AS total
FROM weather_observations
GROUP BY month_name, month
ORDER BY month;

QUERY weather_by_month AS
SELECT
    o.month_name AS "Month",
    observations * 1.0 / total AS "Share",
    weather as "Weather"
FROM weather_observations o, weather_observations_total t
WHERE o.month_name = t.month_name
ORDER BY o.month ASC, weather ASC;

QUERY temperature_humidity AS
SELECT
    temp as "Temperature",
    humidity as "Humidity"
FROM weather
ORDER BY RANDOM() LIMIT 500;

VISUALIZE "Weather Data (Table)" FROM weather USING TABLE;

VISUALIZE "Weather Monthly (Table)" FROM weather_monthly USING TABLE;

VISUALIZE "Temperature 3 years (Table)" FROM temperature_3_years USING TABLE;

VISUALIZE "Temperature 3 years (Line Chart)" FROM temperature_3_years USING LINE;

VISUALIZE "Temperature 40 years (Table)" FROM temperature_40_years USING TABLE;

VISUALIZE "Temperature 40 years (Line Chart)" FROM temperature_40_years USING LINE;

VISUALIZE "Weather Observations (Table)" FROM weather_observations USING TABLE;

VISUALIZE "Weather Observations (Stacked Bar Chart)" FROM weather_observations USING BAR;

VISUALIZE "Weather Observations Total (Table)" FROM weather_observations_total USING TABLE;

VISUALIZE "Weather Observations Total (Bar Chart)" FROM weather_observations_total USING BAR;

VISUALIZE "Weather by Month (Table)" FROM weather_by_month USING TABLE;

VISUALIZE "Weather by Month (Stacked Bar Chart)" FROM weather_by_month USING BAR;

VISUALIZE "Temperature and Humidity (Table)" FROM temperature_humidity USING TABLE;

VISUALIZE "Temperature and Humidity (Scatter Plot)" FROM temperature_humidity USING SCATTER;
