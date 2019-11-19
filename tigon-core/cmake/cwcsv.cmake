# ---------------------------------------------------------------------------
# Tigon
# (c) 2019 Andre Kohn
# ---------------------------------------------------------------------------

include(ExternalProject)

set(CWCSV_INCLUDE_DIR ${CMAKE_SOURCE_DIR}/../submodules/cwcsv/include)

add_library(cwcsv INTERFACE)
set_property(TARGET cwcsv APPEND PROPERTY INTERFACE_INCLUDE_DIRECTORIES ${CWCSV_INCLUDE_DIR})
