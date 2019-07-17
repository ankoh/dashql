
TQL

```
declare parameter days as integer;

load raw_data from http (
    method = "get",
    url = "http://history.openweathermap.org/{{days}}"
);

extract raw_data into weather_data using jsonpath (
    day = '$.values[*].foo' as integer,
    value = '$.values[*].bar' as float,
);

define output as
    select * from weather_data;

```
