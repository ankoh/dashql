CREATE TABLE weather_daily AS (
    WITH weather_date AS (
        SELECT
            CAST(CONCAT(YEAR(date), '-', MONTH(date), '-', DAY(date)) AS DATE) as date,
            city,
            temp,
            temp_apparent,
            temp_min,
            temp_max,
            pressure,
            humidity,
            wind_speed,
            cloudiness,
            weather
        FROM weather
    ),
    weather_count AS (
        SELECT
            date,
            weather,
            count(*) AS count
        FROM weather_date
        GROUP BY date, weather
        ORDER BY date ASC, count DESC
    )

    SELECT
        date,
        city,
        AVG(temp) AS temp,
        AVG(temp_apparent) AS temp_apparent,
        MIN(temp_min) AS temp_min,
        MAX(temp_max) AS temp_max,
        AVG(pressure) AS pressure,
        AVG(humidity) AS humidity,
        AVG(wind_speed) AS wind_speed,
        AVG(cloudiness) AS cloudiness,
        (
            SELECT c.weather
            FROM weather_count c
            WHERE w.date = c.date
        ) AS weather
    FROM weather_date w
    GROUP BY date, city
    ORDER BY city ASC, date ASC
);

COPY weather_daily TO 'weather_daily.csv' (HEADER);
