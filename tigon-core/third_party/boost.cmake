# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

# Note that we cannot link to boost in webassembly.
# If this ever happens, we're out of luck anyway.

# Thrift only depends on headers.

include(ExternalProject)
include(ProcessorCount)
ProcessorCount(NPROCS)

if(DEFINED ENV{EMSDK})

    ExternalProject_Add(boost_ep
        BUILD_IN_SOURCE 1
        URL "http://sourceforge.net/projects/boost/files/boost/1.70.0/boost_1_70_0.tar.gz"
        PREFIX "${CMAKE_BINARY_DIR}/third_party/boost"
        INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/boost/install"
        CONFIGURE_COMMAND ./bootstrap.sh
            --without-icu
            --with-libraries=system,filesystem,regex
            --prefix=<INSTALL_DIR>
        BUILD_COMMAND ./b2
            -j${NPROCS}
            --disable-icu
            toolset=emscripten
            link=static variant=release threading=single
            runtime-link=static
            system regex filesystem
            install
        INSTALL_COMMAND ""
        BUILD_BYPRODUCTS
            <INSTALL_DIR>/lib/libboost_system.bc
            <INSTALL_DIR>/lib/libboost_filesystem.bc
            <INSTALL_DIR>/lib/libboost_regex.bc
    )


    ExternalProject_Get_Property(boost_ep install_dir)
    set(BOOST_INCLUDE_DIR ${install_dir}/include)
    set(BOOST_INCLUDE_DIRS ${install_dir}/include)
    set(BOOST_LIBRARY_DIR ${install_dir}/lib)

    file(MAKE_DIRECTORY ${BOOST_INCLUDE_DIR})
    file(MAKE_DIRECTORY ${BOOST_LIBRARY_DIR})

    add_library(boost_system STATIC IMPORTED)
    set_property(TARGET boost_system PROPERTY IMPORTED_LOCATION ${BOOST_LIBRARY_DIR}/libboost_system.bc)
    set_property(TARGET boost_system APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${BOOST_INCLUDE_DIR})

    add_library(boost_filesystem STATIC IMPORTED)
    set_property(TARGET boost_filesystem PROPERTY IMPORTED_LOCATION ${BOOST_LIBRARY_DIR}/libboost_filesystem.bc)
    set_property(TARGET boost_filesystem APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${BOOST_INCLUDE_DIR})

    add_library(boost_regex STATIC IMPORTED)
    set_property(TARGET boost_regex PROPERTY IMPORTED_LOCATION ${BOOST_LIBRARY_DIR}/libboost_regex.bc)
    set_property(TARGET boost_regex APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${BOOST_INCLUDE_DIR})

else()

    ExternalProject_Add(boost_ep
        BUILD_IN_SOURCE 1
        URL "http://sourceforge.net/projects/boost/files/boost/1.70.0/boost_1_70_0.tar.gz"
        PREFIX "${CMAKE_BINARY_DIR}/third_party/boost"
        INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/boost/install"
        CONFIGURE_COMMAND ./bootstrap.sh
            --without-icu
            --with-libraries=system,filesystem,regex
            --prefix=<INSTALL_DIR>
        BUILD_COMMAND ./b2
            -j${NPROCS}
            --disable-icu
            link=static variant=release threading=single
            runtime-link=static
            system regex filesystem
            install
        INSTALL_COMMAND ""
        BUILD_BYPRODUCTS
            <INSTALL_DIR>/lib/libboost_system.a
            <INSTALL_DIR>/lib/libboost_filesystem.a
            <INSTALL_DIR>/lib/libboost_regex.a
    )


    ExternalProject_Get_Property(boost_ep install_dir)
    set(BOOST_INCLUDE_DIR ${install_dir}/include)
    set(BOOST_INCLUDE_DIRS ${install_dir}/include)
    set(BOOST_LIBRARY_DIR ${install_dir}/lib)

    file(MAKE_DIRECTORY ${BOOST_INCLUDE_DIR})
    file(MAKE_DIRECTORY ${BOOST_LIBRARY_DIR})

    add_library(boost_system STATIC IMPORTED)
    set_property(TARGET boost_system PROPERTY IMPORTED_LOCATION ${BOOST_LIBRARY_DIR}/libboost_system.a)
    set_property(TARGET boost_system APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${BOOST_INCLUDE_DIR})

    add_library(boost_filesystem STATIC IMPORTED)
    set_property(TARGET boost_filesystem PROPERTY IMPORTED_LOCATION ${BOOST_LIBRARY_DIR}/libboost_filesystem.a)
    set_property(TARGET boost_filesystem APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${BOOST_INCLUDE_DIR})

    add_library(boost_regex STATIC IMPORTED)
    set_property(TARGET boost_regex PROPERTY IMPORTED_LOCATION ${BOOST_LIBRARY_DIR}/libboost_regex.a)
    set_property(TARGET boost_regex APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${BOOST_INCLUDE_DIR})

endif()
