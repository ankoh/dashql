# Copyright (c) 2020 The DashQL Authors

include(ExternalProject)

set (WASMTIME_VERSION v0.23.0)
set (WASMTIME_REPO "https://github.com/bytecodealliance/wasmtime")
set (WASMTIME_COMMIT "81c67d94380736c2b041bdaa271bb4f2bdba689e")
set (WASMTIME_SOURCES "https://github.com/bytecodealliance/wasmtime/archive/${WASMTIME_VERSION}.tar.gz")
set (WASMTIME_LINUX_X86 "https://github.com/bytecodealliance/wasmtime/releases/download/${WASMTIME_VERSION}/wasmtime-${WASMTIME_VERSION}-x86_64-linux-c-api.tar.xz")
set (WASMTIME_MACOS_X86 "https://github.com/bytecodealliance/wasmtime/releases/download/${WASMTIME_VERSION}/wasmtime-${WASMTIME_VERSION}-x86_64-macos-c-api.tar.xz")

set (WASMTIME_PREBUILT)
if (CMAKE_SYSTEM_PROCESSOR MATCHES "(x86)|(X86)|(amd64)|(AMD64)")
    if (UNIX)
        set (WASMTIME_PREBUILT ${WASMTIME_LINUX_X86})
    elseif (APPLE)
        set (WASMTIME_PREBUILT ${WASMTIME_MACOS_X86})
    endif ()
endif ()
message (STATUS "WASMTIME_PREBUILT=${WASMTIME_PREBUILT}")

if (WASMTIME_PREBUILT)
    include(FetchContent)
    FetchContent_Declare(
        wasmtime_archive
        URL ${WASMTIME_PREBUILT}
    )
    FetchContent_GetProperties(wasmtime_archive)
    if(NOT wasmtime_archive_POPULATED)
        FetchContent_Populate(wasmtime_archive)
    endif()
    
    set(WASMTIME_INCLUDE_DIR ${wasmtime_archive_SOURCE_DIR}/include)
    set(WASMTIME_LIBRARY_PATH ${wasmtime_archive_SOURCE_DIR}/lib/libwasmtime.a)
else ()
    include(ExternalProject)
    ExternalProject_Add(
        wasmtime_ep
        GIT_REPOSITORY ${WASMTIME_REPO}
        GIT_TAG ${WASMTIME_COMMIT}
        PREFIX "${CMAKE_BINARY_DIR}/third_party/wasmtime"
        INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/wasmtime/install"
        CONFIGURE_COMMAND ""
        BUILD_IN_SOURCE TRUE
        BUILD_COMMAND cargo build --release -p wasmtime-c-api
        INSTALL_COMMAND
            COMMAND ${CMAKE_COMMAND} -E make_directory <INSTALL_DIR>/lib
            COMMAND ${CMAKE_COMMAND} -E copy <SOURCE_DIR>/target/release/libwasmtime.a <INSTALL_DIR>/lib/
        BUILD_BYPRODUCTS
            <INSTALL_DIR>/lib/libwasmtime.a
    )

    ExternalProject_Get_Property(wasmtime_ep install_dir)
    set(WASMTIME_INCLUDE_DIR ${install_dir}/include)
    set(WASMTIME_LIBRARY_PATH ${install_dir}/lib/libwasmtime.a)
    file(MAKE_DIRECTORY ${WASMTIME_INCLUDE_DIR})
endif ()

message (STATUS "WASMTIME_LIBRARY_PATH=${WASMTIME_LIBRARY_PATH}")
message (STATUS "WASMTIME_INCLUDE_DIR=${WASMTIME_INCLUDE_DIR}")

add_library(wasmtime STATIC IMPORTED)
set_property(TARGET wasmtime PROPERTY IMPORTED_LOCATION ${WASMTIME_LIBRARY_PATH})
set_property(TARGET wasmtime APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${WASMTIME_INCLUDE_DIR})

# Add wasm api library 
add_library(wasm_api INTERFACE)
set_property(TARGET wasm_api APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES "${CMAKE_SOURCE_DIR}/../submodules/wasm-c-api/include")
target_link_libraries(wasm_api INTERFACE wasmtime dl)