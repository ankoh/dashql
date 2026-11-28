"""Run bison with the Rust table skeleton (//grammar/rust:tables.rs.m4)."""

def bison_rust_tables(name, grammar, out, **kwargs):
    """Generate the LALR(1) tables of a bison grammar as a Rust module.

    Args:
        name: The target name.
        grammar: The bison grammar (.y) label.
        out: The generated Rust file.
        **kwargs: Forwarded to the genrule.
    """
    native.genrule(
        name = name,
        srcs = [grammar, "//grammar/rust:tables.rs.m4"],
        outs = [out],
        tools = ["@bison_src//:bison", "@m4_src//:m4"],
        # The prebuilt bison fails with a broken pipe to m4 inside the sandbox.
        local = 1,
        cmd = (
            "export PATH=\"$$(dirname $(location @m4_src//:m4)):$$(dirname $(location @bison_src//:bison)):$$PATH\" && " +
            "$(location @bison_src//:bison) " +
            "--skeleton=$$PWD/$(location //grammar/rust:tables.rs.m4) " +
            "-Wno-other -Werror=conflicts-sr -Werror=conflicts-rr " +
            "--output=$@ " +
            "$(location " + grammar + ")"
        ),
        **kwargs
    )
