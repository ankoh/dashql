include(ExternalProject)

ExternalProject_Add(
    rapidjson_ep
    GIT_REPOSITORY "https://github.com/Tencent/rapidjson.git"
    GIT_TAG 24b5e7a8b27f42fa16b96fc70aade9106cf7102f
    PREFIX "external_rapidjson"
    INSTALL_DIR "external_rapidjson/install"
    UPDATE_DISCONNECTED True
    CMAKE_GENERATOR ${CMAKE_GENERATOR}
    CMAKE_ARGS
        -DCMAKE_INSTALL_PREFIX=${CMAKE_BINARY_DIR}/external_rapidjson/install
        -DCMAKE_CXX_STANDARD=20
        -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
        -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
        -DCMAKE_TOOLCHAIN_FILE=${CMAKE_TOOLCHAIN_FILE}
        -DCMAKE_BUILD_TYPE=Release
        -DRAPIDJSON_BUILD_DOC=FALSE
        -DRAPIDJSON_BUILD_EXAMPLES=FALSE
        -DRAPIDJSON_BUILD_TESTS=FALSE
        -DRAPIDJSON_BUILD_THIRDPARTY_GTEST=FALSE
        -DCMAKE_POLICY_DEFAULT_CMP0017=NEW
        -DCMAKE_POLICY_DEFAULT_CMP0175=OLD
        -DRAPIDJSON_ENABLE_INSTRUMENTATION_OPT=OFF
)

# Prepare json
ExternalProject_Get_Property(rapidjson_ep install_dir)
set(RAPIDJSON_INCLUDE_DIR ${install_dir}/include)
file(MAKE_DIRECTORY ${RAPIDJSON_INCLUDE_DIR})
add_library(rapidjson INTERFACE)
target_include_directories(rapidjson SYSTEM INTERFACE ${RAPIDJSON_INCLUDE_DIR})

# Dependencies
add_dependencies(rapidjson rapidjson_ep)

