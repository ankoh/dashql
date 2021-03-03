# Copyright (c) 2020 The DashQL Authors

set(V8_LIBRARY_SEARCH_PATHS
    ~/Library/Frameworks
    /Library/Frameworks
    /usr/local/lib
    /usr/lib
    /sw/lib
    /opt/local/lib
    /opt/csw/lib
    /opt/lib
    /usr/freeware/lib64
)

find_path(V8_INCLUDE_DIR v8/v8.h
    ~/Library/Frameworks
    /Library/Frameworks
    /usr/local/include
    /usr/include
    /sw/include # Fink
    /opt/local/include # DarwinPorts
    /opt/csw/include # Blastwave
    /opt/include
    /usr/freeware/include
    /devel
)

find_library(V8_LIBRARY
    NAMES v8 libv8
    PATHS ${V8_LIBRARY_SEARCH_PATHS}
)

find_library(V8_LIBBASE_LIBRARY
    NAMES v8_libbase libv8_libbase
    PATHS ${V8_LIBRARY_SEARCH_PATHS}
)

find_library(V8_LIBPLATFORM_LIBRARY
    NAMES v8_libplatform libv8_libplatform
    PATHS ${V8_LIBRARY_SEARCH_PATHS}
)

find_library(V8_LIBSAMPLER_LIBRARY
    NAMES v8_libsampler libv8_libsampler
    PATHS ${V8_LIBRARY_SEARCH_PATHS}
)

set(V8_FOUND FALSE)

if(V8_LIBRARY AND V8_LIBBASE_LIBRARY AND V8_LIBPLATFORM_LIBRARY AND V8_LIBSAMPLER_LIBRARY)
    set(V8_FOUND TRUE)
endif()

message(STATUS "V8=${V8_FOUND}")