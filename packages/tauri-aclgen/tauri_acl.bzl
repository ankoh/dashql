"""Rule to pre-generate Tauri ACL files from plugin permission TOMLs and capabilities."""

def _gen_tauri_acl_impl(ctx):
    # Use a TreeArtifact (directory) so the cargo_build_script env var can
    # reference a single path containing all three output JSON files.
    out_dir = ctx.actions.declare_directory(ctx.attr.name)

    args = ctx.actions.args()
    args.add("--core-config", ctx.file.core_config)
    args.add("--out-dir", out_dir.path)

    inputs = [ctx.file.core_config]

    # Add capability files
    for f in ctx.files.capabilities:
        args.add("--capability", f)
        inputs.append(f)

    # Add plugin permission files: label_keyed_string_dict maps Target -> string
    for target, plugin_name in ctx.attr.plugins.items():
        for f in target.files.to_list():
            args.add("--plugin-file", "%s=%s" % (plugin_name, f.path))
            inputs.append(f)

    ctx.actions.run(
        executable = ctx.executable.tool,
        arguments = [args],
        inputs = inputs,
        outputs = [out_dir],
        mnemonic = "GenTauriAcl",
        progress_message = "Generating Tauri ACL manifests",
    )

    return [DefaultInfo(files = depset([out_dir]))]

gen_tauri_acl = rule(
    implementation = _gen_tauri_acl_impl,
    attrs = {
        "core_config": attr.label(
            allow_single_file = [".toml"],
            mandatory = True,
            doc = "Core permissions config (acl_core_permissions.toml)",
        ),
        "capabilities": attr.label_list(
            allow_files = [".json"],
            doc = "Capability JSON files (e.g. acl_capabilities.json)",
        ),
        "plugins": attr.label_keyed_string_dict(
            allow_files = [".toml"],
            doc = "Map of plugin permission filegroups to plugin names",
        ),
        "tool": attr.label(
            executable = True,
            cfg = "exec",
            mandatory = True,
            doc = "The tauri-aclgen binary",
        ),
    },
)
