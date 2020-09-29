CREATE TABLE weather_openweathermap (
    dt INTEGER,
    dt_iso TIMESTAMP,
    timezone INTEGER,
    city_name VARCHAR,
    lat DOUBLE,
    lon DOUBLE,
    temp DOUBLE,
    feels_like DOUBLE,
    temp_min DOUBLE,
    temp_max DOUBLE,
    pressure DOUBLE,
    sea_level DOUBLE,
    grnd_level DOUBLE,
    humidity DOUBLE,
    wind_speed DOUBLE,
    wind_deg DOUBLE,
    rain_1h DOUBLE,
    rain_3h DOUBLE,
    snow_1h DOUBLE,
    snow_3h DOUBLE,
    clouds_all DOUBLE,
    weather_id INTEGER,
    weather_main VARCHAR,
    weather_description VARCHAR,
    weather_icon VARCHAR
);

COPY weather_openweathermap FROM 'openweathermap.csv' (HEADER);

CREATE TABLE weather AS (
    SELECT
        dt_iso AS date,
        city_name AS city,
        temp,
        feels_like AS temp_apparent,
        temp_min,
        temp_max,
        pressure,
        humidity,
        wind_speed,
        clouds_all AS cloudiness,
        weather_main AS weather
    FROM weather_openweathermap
);

COPY weather TO 'weather.csv' (HEADER);
