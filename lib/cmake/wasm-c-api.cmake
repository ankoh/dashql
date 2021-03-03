# Copyright (c) 2020 The DashQL Authors

include(ExternalProject)

# Find V8
find_package(V8)
if (NOT V8_FOUND) 
    return()
endif()

set (HAVE_WASM_RUNTIME TRUE)

# Add cmake library for v8
add_library(v8 INTERFACE)
set_property(TARGET v8 APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${V8_INCLUDE_DIR})
target_link_libraries(v8 INTERFACE ${V8_LIBRARY} ${V8_LIBBASE_LIBRARY} ${V8_LIBPLATFORM_LIBRARY}  ${V8_LIBSAMPLER_LIBRARY})

# Add wasm api library 
add_library(wasm_api INTERFACE)
set_property(TARGET wasm_api APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES "${CMAKE_SOURCE_DIR}/../submodules/wasm-c-api/include")
target_link_libraries(wasm_api INTERFACE v8)