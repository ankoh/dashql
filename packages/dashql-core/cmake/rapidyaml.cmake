include(ExternalProject)

# rapidyaml (ryml) - header-only style lib but builds ryml + c4core static libs
# Only used for native tests (tester). Requires ext/c4core submodule.
ExternalProject_Add(
    rapidyaml_ep
    GIT_REPOSITORY "https://github.com/biojppm/rapidyaml.git"
    GIT_TAG v0.10.0
    GIT_SUBMODULES "ext/c4core"
    GIT_SHALLOW FALSE
    TIMEOUT 30
    PREFIX "external_rapidyaml"
    INSTALL_DIR "external_rapidyaml/install"
    UPDATE_DISCONNECTED True
    CMAKE_ARGS
        -G${CMAKE_GENERATOR}
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/external_rapidyaml/install
        -DCMAKE_CXX_STANDARD=20
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_BUILD_TYPE=Release
        -DRYML_BUILD_TOOLS=OFF
        -DRYML_INSTALL=ON
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/lib/libryml.a
        <INSTALL_DIR>/lib/libc4core.a
)

ExternalProject_Get_Property(rapidyaml_ep install_dir)
set(RAPIDYAML_INCLUDE_DIR ${install_dir}/include)
set(RAPIDYAML_LIBRARY_PATH ${install_dir}/lib/libryml.a)
set(C4CORE_LIBRARY_PATH ${install_dir}/lib/libc4core.a)
file(MAKE_DIRECTORY ${RAPIDYAML_INCLUDE_DIR})

add_library(c4core STATIC IMPORTED)
set_property(TARGET c4core PROPERTY IMPORTED_LOCATION ${C4CORE_LIBRARY_PATH})
set_property(TARGET c4core APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${RAPIDYAML_INCLUDE_DIR})
add_dependencies(c4core rapidyaml_ep)

add_library(rapidyaml STATIC IMPORTED)
set_property(TARGET rapidyaml PROPERTY IMPORTED_LOCATION ${RAPIDYAML_LIBRARY_PATH})
set_property(TARGET rapidyaml APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${RAPIDYAML_INCLUDE_DIR})
set_property(TARGET rapidyaml APPEND PROPERTY INTERFACE_LINK_LIBRARIES c4core)
add_dependencies(rapidyaml rapidyaml_ep)
