"""Bzlmod extension: fetch flatbuffers, ankerl, rapidjson, prebuilt bison for dashql-core."""

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")
load("//packages/dashql-core/bazel:bison_prebuilt.bzl", "bison_prebuilt_repository")
load("//packages/dashql-core/bazel:m4_prebuilt.bzl", "m4_prebuilt_repository")
load("//packages/dashql-core/bazel:flex_prebuilt.bzl", "flex_prebuilt_repository")

def _dashql_deps_impl(mctx):
    # Use upstream BUILD; dashql adds FLATBUFFERS_NO_ABSOLUTE_PATH_RESOLUTION via copts.
    http_archive(
        name = "com_google_flatbuffers",
        strip_prefix = "flatbuffers-ee848a02e17a94edaacd1dd95a1664b59c6f06b2",
        urls = ["https://github.com/google/flatbuffers/archive/ee848a02e17a94edaacd1dd95a1664b59c6f06b2.zip"],
    )
    # Archive uses full commit in dir name
    http_archive(
        name = "ankerl_unordered_dense",
        strip_prefix = "unordered_dense-3add2a63444869d123e24792f17b5618edfaee44",
        urls = ["https://github.com/martinus/unordered_dense/archive/3add2a63444869d123e24792f17b5618edfaee44.zip"],
        build_file = "//packages/dashql-core/bazel:ankerl.BUILD",
    )
    http_archive(
        name = "rapidjson",
        strip_prefix = "rapidjson-24b5e7a8b27f42fa16b96fc70aade9106cf7102f",
        urls = ["https://github.com/Tencent/rapidjson/archive/24b5e7a8b27f42fa16b96fc70aade9106cf7102f.zip"],
        build_file = "//packages/dashql-core/bazel:rapidjson.BUILD",
    )
    # c4core: base lib for rapidyaml (c4::substr, format, etc.)
    http_archive(
        name = "c4core",
        strip_prefix = "c4core-828c552761e43de8a7c2807acc4fd6276bd6e9b1",
        urls = ["https://github.com/biojppm/c4core/archive/828c552761e43de8a7c2807acc4fd6276bd6e9b1.zip"],
        build_file = "//packages/dashql-core/bazel:c4core.BUILD",
    )
    # rapidyaml (ryml): YAML for snapshot tests. Depends on c4core.
    http_archive(
        name = "rapidyaml",
        strip_prefix = "rapidyaml-653eac9741c7728f2a87435b981737894149e002",
        urls = ["https://github.com/biojppm/rapidyaml/archive/653eac9741c7728f2a87435b981737894149e002.zip"],
        build_file = "//packages/dashql-core/bazel:rapidyaml.BUILD",
    )
    # Prebuilt Bison 3.8.2 (xPack) and M4 (needed by bison at runtime)
    bison_prebuilt_repository(name = "bison_src")
    m4_prebuilt_repository(name = "m4_src")
    # Prebuilt Flex 2.6.4 (xPack)
    flex_prebuilt_repository(name = "flex_src")

dashql_deps = module_extension(
    implementation = _dashql_deps_impl,
)
