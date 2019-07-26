# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

# Note that we cannot link to boost in webassembly.
# If this ever happens, we're out of luck anyway.

# Thrift only depends on headers.

include(ExternalProject)

ExternalProject_Add(boost_ep
    URL "http://sourceforge.net/projects/boost/files/boost/1.68.0/boost_1_68_0.tar.gz"
    PREFIX "${CMAKE_BINARY_DIR}/third_party/boost"
    CONFIGURE_COMMAND ""
    BUILD_COMMAND ""
    INSTALL_COMMAND ""
)

ExternalProject_Get_Property(boost_ep source_dir)
set(BOOST_INCLUDE_DIR ${source_dir})
set(BOOST_INCLUDE_DIRS ${source_dir})
file(MAKE_DIRECTORY ${BOOST_INCLUDE_DIR})
