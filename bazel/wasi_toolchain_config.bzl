"""WASI SDK C++ toolchain config: wasm32-wasi via prebuilt clang + wasi-sysroot."""

load("@rules_cc//cc:action_names.bzl", "ACTION_NAMES")
load(
    "@rules_cc//cc:cc_toolchain_config_lib.bzl",
    "artifact_name_pattern",
    "feature",
    "flag_group",
    "flag_set",
    "tool_path",
)
load("@rules_cc//cc/common:cc_common.bzl", "cc_common")
load("@rules_cc//cc/toolchains:cc_toolchain_config_info.bzl", "CcToolchainConfigInfo")

# All compile and link actions that must get --sysroot (so transitive cc_library get it too).
_ALL_COMPILE_ACTIONS = [
    ACTION_NAMES.c_compile,
    ACTION_NAMES.cpp_compile,
    ACTION_NAMES.linkstamp_compile,
    ACTION_NAMES.assemble,
    ACTION_NAMES.preprocess_assemble,
    ACTION_NAMES.cpp_header_parsing,
    ACTION_NAMES.cpp_module_compile,
    ACTION_NAMES.cpp_module_codegen,
]
# Linker (wasm-ld) actions only; exclude cpp_link_static_library (archiver llvm-ar gets these flags otherwise).
_LINKER_ACTIONS = [
    ACTION_NAMES.cpp_link_executable,
    ACTION_NAMES.cpp_link_dynamic_library,
    ACTION_NAMES.cpp_link_nodeps_dynamic_library,
]

def _derive_clang_resource_include(resource_files):
    include_suffix = "/include"
    include_marker = "/include/"
    for path in sorted([f.path for f in resource_files]):
        if "/lib/clang/" not in path:
            continue
        marker_index = path.find(include_marker)
        if marker_index == -1:
            continue
        return path[:marker_index + len(include_suffix)]
    fail("Unable to derive Clang resource include directory from clang_resource_dir files")

def _wasi_cc_toolchain_config_impl(ctx):
    # Use wrappers so tools are resolved at runtime (works in sandbox).
    tool_paths = [
        tool_path(name = "ar", path = "bin/llvm-ar.wrapper"),
        tool_path(name = "cpp", path = "bin/clang++.wrapper"),
        tool_path(name = "gcc", path = "bin/clang++.wrapper"),
        tool_path(name = "gcov", path = "/bin/false"),
        tool_path(name = "ld", path = "bin/wasm-ld"),
        tool_path(name = "nm", path = "bin/llvm-nm"),
        tool_path(name = "objdump", path = "bin/llvm-objdump"),
        tool_path(name = "strip", path = "bin/llvm-strip"),
    ]

    # For builtin include allowlist and for link action --sysroot.
    # Derive from compiler path so we get the actual repo path (e.g. external/+dashql_core_dependencies+wasi_sdk).
    compiler_path = ctx.file.compiler_binary.path
    bin_dir = compiler_path[:compiler_path.rfind("/")]
    repo_root = bin_dir[:bin_dir.rfind("/")]
    sysroot = repo_root + "/share/wasi-sysroot"
    clang_resource_include = _derive_clang_resource_include(ctx.files.clang_resource_dir)
    clang_resource_dir = clang_resource_include[:clang_resource_include.rfind("/include")]

    # --sysroot for linker (wasm-ld) only; not for archiver (llvm-ar).
    # Compile gets --sysroot from the wrapper (absolute path so headers are found).
    sysroot_feature = feature(
        name = "sysroot",
        enabled = True,
        flag_sets = [
            flag_set(
                actions = _LINKER_ACTIONS,
                flag_groups = [
                    flag_group(
                        flags = ["--sysroot=%{sysroot}"],
                        expand_if_available = "sysroot",
                    ),
                ],
            ),
        ],
    )

    # Required so clang uses wasm32-wasip1 sysroot layout (include/wasm32-wasip1/c++/v1/).
    wasm_target_feature = feature(
        name = "wasm_target",
        enabled = True,
        flag_sets = [
            flag_set(
                actions = _ALL_COMPILE_ACTIONS,
                flag_groups = [
                    flag_group(flags = ["--target=wasm32-wasip1"]),
                ],
            ),
        ],
    )

    # Keep include/resource discovery exec-root-relative under sandboxed execution.
    # Note: include/wasm32-wasip1/c++/v1 must appear before include/wasm32-wasip1 so libc++
    # wrappers include the C headers in the expected order.
    relative_include_paths_feature = feature(
        name = "relative_include_paths",
        enabled = True,
        flag_sets = [
            flag_set(
                actions = _ALL_COMPILE_ACTIONS,
                flag_groups = [
                    flag_group(
                        flags = [
                            "-resource-dir=" + clang_resource_dir,
                            "-ccc-install-dir",
                            repo_root + "/bin",
                            "-isystem",
                            sysroot + "/include/wasm32-wasip1/c++/v1",
                            "-isystem",
                            sysroot + "/include/wasm32-wasip1",
                        ],
                    ),
                ],
            ),
        ],
    )

    # Prevent compiler from resolving includes to absolute paths so Bazel's "absolute path
    # inclusion" check accepts our cxx_builtin_include_directories (which are exec-root-relative).
    no_canonical_prefixes_feature = feature(
        name = "no_canonical_prefixes",
        enabled = True,
        flag_sets = [
            flag_set(
                actions = _ALL_COMPILE_ACTIONS,
                flag_groups = [
                    flag_group(flags = ["-no-canonical-prefixes"]),
                ],
            ),
        ],
    )

    # Builtin includes: C++ and C from wasi-sysroot, plus Clang resource dir (stddef.h, etc.).
    cxx_builtin_include_directories = [
        sysroot + "/include/wasm32-wasip1/c++/v1",
        sysroot + "/include/c++/v1",
        sysroot + "/include/wasm32-wasip1",
        sysroot + "/include",
        clang_resource_include,
    ]

    # Output executables with .wasm extension (like .a for static libs).
    artifact_name_patterns = [
        artifact_name_pattern(
            category_name = "executable",
            prefix = "",
            extension = ".wasm",
        ),
    ]

    return cc_common.create_cc_toolchain_config_info(
        ctx = ctx,
        toolchain_identifier = "wasi-sdk",
        host_system_name = "local",
        target_system_name = "wasi",
        target_cpu = "wasm32",
        target_libc = "wasi",
        compiler = "clang",
        abi_version = "unknown",
        abi_libc_version = "unknown",
        tool_paths = tool_paths,
        cxx_builtin_include_directories = cxx_builtin_include_directories,
        builtin_sysroot = sysroot,
        features = [
            sysroot_feature,
            wasm_target_feature,
            relative_include_paths_feature,
            no_canonical_prefixes_feature,
        ],
        artifact_name_patterns = artifact_name_patterns,
    )

wasi_cc_toolchain_config = rule(
    implementation = _wasi_cc_toolchain_config_impl,
    attrs = {
        "compiler_binary": attr.label(
            mandatory = True,
            allow_single_file = True,
            doc = "Label to clang++ wrapper in the WASI SDK repo.",
        ),
        "clang_resource_dir": attr.label(
            mandatory = True,
            allow_files = True,
            doc = "Label exposing files under lib/clang/*/include for deriving the resource dir.",
        ),
    },
    provides = [CcToolchainConfigInfo],
)
