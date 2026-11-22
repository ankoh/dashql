#!/usr/bin/env python3
"""
Assembles the dashql.y grammar from grammar fragments: prologue, keyword declarations/rules from
.list files, precedences, types, rule files, epilogue.
Accepts paths via arguments for hermetic Bazel genrules.
"""
import argparse
import os
import sys
from typing import Optional

# The rule of the keywords that may be a column label without AS (BARE_LABEL)
BARE_LABEL_RULE = "sql_bare_label_keywords"


def entry_from_list_line(line: str) -> Optional[tuple[str, bool]]:
    """Extract (token, bare label) from X(CATEGORY, "keyword", TOKEN, BARE_LABEL | AS_LABEL)."""
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    parts = [p.strip() for p in line.rstrip(")").split(",")]
    if len(parts) != 4 or parts[3] not in ("BARE_LABEL", "AS_LABEL"):
        raise SystemExit(f"cannot parse keyword {line!r}")
    return parts[2], parts[3] == "BARE_LABEL"


def process_keyword_list(path: str) -> tuple[str, list[str], list[str]]:
    """Return (basename without .list, list of token names, list of bare label token names)."""
    basename = os.path.splitext(os.path.basename(path))[0]
    tokens = []
    bare = []
    with open(path) as f:
        for line in f:
            entry = entry_from_list_line(line)
            if entry:
                tokens.append(entry[0])
                if entry[1]:
                    bare.append(entry[0])
    return basename, tokens, bare


def write_rule(out, name: str, tokens: list[str]):
    """A rule that passes through the text of its keywords"""
    out.write("\n")
    out.write(name)
    out.write(":")
    for i, t in enumerate(tokens):
        if i > 0:
            out.write(" | ")
        out.write(t)
        out.write("{ $1 }")
    out.write(";\n\n")


def main():
    ap = argparse.ArgumentParser(description="Assemble dashql.y from grammar fragments")
    ap.add_argument("--output", required=True, help="Output .y file")
    ap.add_argument("--prologue", required=True)
    ap.add_argument("--epilogue", required=True)
    ap.add_argument("--precedences", required=True)
    ap.add_argument("--keyword_lists", nargs="+", required=True, help="Paths to .list files")
    ap.add_argument("--type_files", nargs="+", required=True, help="Paths to .yh files")
    ap.add_argument("--rule_files", nargs="+", required=True, help="Paths to .y rule files")
    args = ap.parse_args()

    with open(args.output, "w") as out:
        with open(args.prologue) as f:
            out.write(f.read())

        bare = []
        for path in args.keyword_lists:
            basename, tokens, bare_tokens = process_keyword_list(path)
            bare.extend(bare_tokens)
            if not tokens:
                continue
            out.write("\n%type<Str> ")
            out.write(basename)
            out.write("\n%token<Str> ")
            out.write(" ".join(tokens))
            out.write("\n")
        out.write(f"\n%type<Str> {BARE_LABEL_RULE}\n")

        with open(args.precedences) as f:
            out.write(f.read())

        for path in args.type_files:
            with open(path) as f:
                out.write(f.read())

        out.write("%%\n")

        for path in args.keyword_lists:
            basename, tokens, _ = process_keyword_list(path)
            if tokens:
                write_rule(out, basename, tokens)
        write_rule(out, BARE_LABEL_RULE, sorted(bare))

        for path in args.rule_files:
            with open(path) as f:
                out.write(f.read())

        out.write("%%\n")

        if os.path.exists(args.epilogue):
            with open(args.epilogue) as f:
                out.write(f.read())


if __name__ == "__main__":
    main()
