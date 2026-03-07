"""protoc + protoc-gen-es: TypeScript codegen rule using rules_proto_grpc proto_compile_impl."""

load(
    "@rules_proto_grpc//:defs.bzl",
    "ProtoPluginInfo",
    "proto_compile_attrs",
    "proto_compile_impl",
    "proto_compile_toolchains",
)

# Compile rule: runs protoc with the protoc-gen-es plugin (output_directory mode).
# Plugin is defined in bazel/protobuf/BUILD.bazel; options (target=ts, import_extension=js) are set there.
protoc_typescript_compile = rule(
    implementation = proto_compile_impl,
    attrs = dict(
        proto_compile_attrs,
        _plugins = attr.label_list(
            providers = [ProtoPluginInfo],
            default = [Label("//bazel/protobuf:protoc_typescript_plugin")],
            cfg = "exec",
            doc = "protoc plugins to apply (protoc-gen-es for TypeScript)",
        ),
    ),
    toolchains = proto_compile_toolchains,
)
