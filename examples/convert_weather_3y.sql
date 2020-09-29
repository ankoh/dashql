CREATE TABLE weather_3y AS (
    SELECT *
    FROM weather
    WHERE date >= (
        SELECT CAST(CONCAT(YEAR(date) - 5, '-', MONTH(date), '-', DAY(date)) AS DATE)
        FROM (
            SELECT date
            FROM weather
            ORDER BY date DESC
            LIMIT 1
        ) AS weather
    )
);

COPY weather_3y TO 'weather_3y.csv' (HEADER);
