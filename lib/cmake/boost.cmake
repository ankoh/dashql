# Copyright (c) 2020 The DashQL Authors

set (BOOST_VERSION 1.68.0)
set (BOOST_TARBALL boost_1_68_0.tar.gz)
set (BOOST_URL "http://dl.bintray.com/boostorg/release/${BOOST_VERSION}/source/${BOOST_TARBALL}")

set(BOOST_INSTALL_DIR "${CMAKE_BINARY_DIR}/third_party/boost/install")
set(BOOST_INCLUDE_DIR "${BOOST_INSTALL_DIR}/include")
set(BOOST_LIBRARY_DIR "${BOOST_INSTALL_DIR}/lib")

file(MAKE_DIRECTORY ${BOOST_INCLUDE_DIR})
file(MAKE_DIRECTORY ${BOOST_LIBRARY_DIR})

include(FetchContent)
FetchContent_Declare(
    boost
    URL ${BOOST_URL}
)

FetchContent_GetProperties(boost)
if(NOT boost_POPULATED)
    FetchContent_Populate(boost)
    file(COPY ${boost_SOURCE_DIR}/boost DESTINATION ${BOOST_INCLUDE_DIR})
endif()

set(BOOST_ROOT ${boost_SOURCE_DIR})
