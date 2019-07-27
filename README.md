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

display wheather_data using line chart;
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

display wheather_data using line chart (
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

## Build Instructions

### Core

#### Webassembly Build

```

source ${PATH_TO_EMSDK}/emsdk_env.sh

./build_core.sh

```

#### Debug Build

```

mkdir -p tigon-core/build/debug

cd tigon-core/build/debug

cmake \
    -GNinja \
    -DCMAKE_BUILD_TYPE=Debug \
    -DCMAKE_EXPORT_COMPILE_COMMANDS=1 \
    ../../

# On macOS, use a newer clang from homebrew that ships with filesystem support
cmake \
    -GNinja \
    -DCMAKE_BUILD_TYPE=Debug \
    -DCMAKE_EXPORT_COMPILE_COMMANDS=1 \
    -DCMAKE_CXX_COMPILER=/usr/local/cellar/llvm@7/7.0.1/bin/clang++ \
    -DCMAKE_C_COMPILER=/usr/local/cellar/llvm@7/7.0.1/bin/clang \
    ../../

ninja

```
