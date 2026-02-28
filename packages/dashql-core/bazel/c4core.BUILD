# c4core: low-level C++ utilities (dependency of rapidyaml).
# See https://github.com/biojppm/c4core
load("@rules_cc//cc:defs.bzl", "cc_library")

package(default_visibility = ["//visibility:public"])

cc_library(
    name = "c4core",
    srcs = glob(["src/c4/**/*.cpp"]),
    hdrs = glob([
        "src/c4/**/*.h",
        "src/c4/**/*.hpp",
    ]),
    includes = ["src"],
    copts = ["-DC4CORE_WITH_FASTFLOAT=1"],
    # Export so dependents (e.g. rapidyaml) compiling c4 headers get this; ext/debugbreak not in archive.
    defines = ["C4_NO_DEBUG_BREAK"],
)
