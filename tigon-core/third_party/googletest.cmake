# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)
find_package(Git REQUIRED)
find_package(Threads REQUIRED)

# Build gtest
ExternalProject_Add(
    gtest_build
    PREFIX "${CMAKE_BINARY_DIR}/third_party/gtest"
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/googletest/googletest"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_CXX_FLAGS=${CMAKE_CXX_FLAGS}
        -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    INSTALL_COMMAND ""
    BUILD_BYPRODUCTS <BINARY_DIR>/libgtest.a
)

# Build gmock
ExternalProject_Add(
    gmock_build
    PREFIX "${CMAKE_BINARY_DIR}/third_party/gmock"
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/third_party/googletest/googlemock"
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_CXX_FLAGS=${CMAKE_CXX_FLAGS}
        -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    INSTALL_COMMAND ""
    BUILD_BYPRODUCTS <BINARY_DIR>/libgmock.a
)

# Prepare gtest
ExternalProject_Get_Property(gtest_build source_dir)
set(GTEST_INCLUDE_DIR ${source_dir}/include)
ExternalProject_Get_Property(gtest_build binary_dir)
set(GTEST_LIBRARY_PATH ${binary_dir}/libgtest.a)
file(MAKE_DIRECTORY ${GTEST_INCLUDE_DIR})
add_library(gtest STATIC IMPORTED)
set_property(TARGET gtest PROPERTY IMPORTED_LOCATION ${GTEST_LIBRARY_PATH})
set_property(TARGET gtest APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${GTEST_INCLUDE_DIR})

# Prepare gmock
ExternalProject_Get_Property(gmock_build source_dir)
set(GMOCK_INCLUDE_DIR ${source_dir}/include)
ExternalProject_Get_Property(gmock_build binary_dir)
set(GMOCK_LIBRARY_PATH ${binary_dir}/libgmock.a)
file(MAKE_DIRECTORY ${GMOCK_INCLUDE_DIR})
add_library(gmock STATIC IMPORTED)
set_property(TARGET gmock PROPERTY IMPORTED_LOCATION ${GMOCK_LIBRARY_PATH})
set_property(TARGET gmock APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${GMOCK_INCLUDE_DIR})

# Dependencies
add_dependencies(gtest gtest_build)
add_dependencies(gmock gmock_build)
