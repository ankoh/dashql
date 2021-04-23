# Copyright (c) 2020 The DashQL Authors

include(ExternalProject)

include(ProcessorCount)
ProcessorCount(NCORES)

set(PREFIX_CONF)
set(PREFIX_MAKE CC="ccache ${CC}" CXX="ccache ${CXX}")
if (EMSCRIPTEN)
    set(PREFIX_CONF EMCC_CCACHE=1 emconfigure)
    set(PREFIX_MAKE EMCC_CCACHE=1 emmake)
endif ()

ExternalProject_Add(
    jq_ep
    PREFIX "third_party/jq"
    SOURCE_DIR "${CMAKE_SOURCE_DIR}/../submodules/jq"
    INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/jq/install"
    CONFIGURE_COMMAND
        COMMAND autoreconf -fi <SOURCE_DIR>
        COMMAND ${PREFIX_CONF} <SOURCE_DIR>/configure --disable-maintainer-mode --with-oniguruma=builtin --prefix=<INSTALL_DIR>
    BUILD_COMMAND ${PREFIX_MAKE} make -j${NCORES}
    INSTALL_COMMAND ${PREFIX_MAKE} make install
    DOWNLOAD_COMMAND ""
    UPDATE_COMMAND ""
    BUILD_BYPRODUCTS
        <INSTALL_DIR>/lib/libjq.a
        <INSTALL_DIR>/lib/libonig.a
)

ExternalProject_Get_Property(jq_ep install_dir)
ExternalProject_Get_Property(jq_ep binary_dir)

set(JQ_INCLUDE_DIR "${install_dir}/include")
set(JQ_LIBRARY_PATH "${install_dir}/lib/libjq.a")
set(JQ_ONIG_LIBRARY_PATH "${install_dir}/lib/libonig.a")

file(MAKE_DIRECTORY ${JQ_INCLUDE_DIR})

add_library(jq STATIC IMPORTED)
set_property(TARGET jq PROPERTY IMPORTED_LOCATION ${JQ_LIBRARY_PATH})

target_link_libraries(jq
    INTERFACE ${install_dir}/lib/libonig.a
)

add_dependencies(jq jq_ep)
