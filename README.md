# Tigon

## TigonQL

### Ad-hoc Visualization
```
declare parameter days as integer;

load raw_data from http (
    method = "get",
    url = "http://history.openweathermap.org/{{days}}"
);

extract weather_data from raw_data using jsonpath (
    columns = (
        day = '$.values[*].foo' as integer,
        value = '$.values[*].bar' as float
    )
)

visualize wheather_data using line chart;
```

### Fine-grained Configuration
```
declare parameter days as integer;

load raw_data from http (
    method = "get",
    url = "http://history.openweathermap.org/{{days}}"
);

extract weather_data from raw_data using jsonpath (
    columns = (
        day = '$.values[*].foo' as integer,
        value = '$.values[*].bar' as float
    )
)

visualize wheather_data using line chart (
    layout = (
        width = (
            * = 8,
            sm = 4,
            md = 6,
            lg = 8,
            xl = 8
        ),
        height = (
            * = 100px,
            sm = 200px
        )
    ),
    axes = (
        x = (
            column = a,
            scale = linear
        ),
        y = (
            column = b,
            scale = linear
        )
    ),
    color = (
        column = c,
        palette = [
            rbg(0, 0, 0),
            rbg(0, 0, 0)
        ]
    )
);
```
