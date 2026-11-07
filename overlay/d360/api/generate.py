#!/usr/bin/env python3
"""Generate the Data 360 overlay from its reference documents.

The reference (overlay/d360/docs/) already merges the official contract with what its examples and Salesforce's
own tools add, so it's the source of the spec. Its tables are regular, and the few rules that are only prose are in
this file, see PAGING_RULES and CREDENTIAL_OPTIONS.

    generate.py --reference <dir> --write <spec.json>     Write the spec
    generate.py --reference <dir> --check <spec.json>     Fail if the spec is stale
"""

import argparse
import glob
import json
import os
import re
import sys

NOT_FAMILIES = {"overview.md", "functions.md", "api_notes.md"}

# Where `CALL cdp.*` goes. The binding of the Salesforce connector resolves these names.
HOSTS = {
    "core": {"base_path": "/services/data/v{api_version}"},
    "connect": {"base_path": "/services/data/v{api_version}"},
    "tenant": {"base_path": ""},
}

# Connect errors are an array whose message may be a JSON string
ERRORS = {"message": ["/0/message", "/message"], "message_is_json": True}

# The paging of a function when its note is prose, by the start of the note. None means no paging.
PAGING_RULES = [
    ("The spec lists `limit`, `offset` and `order_by` here", None),
    ("Not applicable", None),
    ("`nextBatchId`, but the spec has no way to send it", None),
    ("`page_token`, taken from `collection.nextPageToken`", {"kind": "token", "from": "/collection/nextPageToken", "option": "page_token"}),
    ("`continuationToken` in `_meta`", {"kind": "token", "from": "/continuationToken", "option": "continuation_token"}),
]

# The options with a list of (param_name, value) pairs, every value has to be a secret unless its name is listed as a
# plain setting. See "Sensitive values" in connections.md.
CREDENTIAL_OPTIONS = {"credentials"}
PUBLIC_CREDENTIAL_PARAMS = [
    "DATABASE",
    "SCHEMA",
    "accountUrl",
    "authenticationOption",
    "hasPrivateNetworkRoute",
    "jdbc_connection_url",
    "outboundnetworkconnection",
    "region",
    "warehouse",
]

COLUMN_TYPES = {"VARCHAR", "TIMESTAMPTZ", "DATE", "INTEGER", "BIGINT", "DOUBLE", "BOOLEAN", "JSON"}


def strip_code(cell):
    """The name in a table cell, without backticks and quotes"""
    return cell.strip().strip("`").strip('"')


def split_row(line):
    """The cells of a table row, a pipe in a cell is escaped"""
    return [c.strip() for c in re.split(r"(?<!\\)\|", line.strip())[1:-1]]


def read_table(lines, begin, first_cell):
    """The rows of the table whose header starts with a cell, searched from a line. Stops at the next heading."""
    for i in range(begin, len(lines)):
        if lines[i].startswith("#"):
            return []
        if lines[i].startswith("| " + first_cell + " |"):
            rows = []
            for line in lines[i + 2 :]:
                if not line.startswith("|"):
                    break
                rows.append(split_row(line))
            return rows
    return []


class Reference:
    """The parsed reference documents"""

    def __init__(self, directory):
        self.problems = []
        self.families = []
        # The schemas by name, and the name of every heading anchor per file and overall
        self.schemas = {}
        self.anchors = {}
        paths = sorted(p for p in glob.glob(os.path.join(directory, "*.md")) if os.path.basename(p) not in NOT_FAMILIES)
        documents = [(os.path.basename(p), open(p, encoding="utf-8").read().splitlines()) for p in paths]
        for file, lines in documents:
            self.read_schemas(file, lines)
        for file, lines in documents:
            self.read_family(file, lines)

    def read_schemas(self, file, lines):
        begin = next((i for i, line in enumerate(lines) if line == "## Schemas"), None)
        if begin is None:
            return
        for i in range(begin + 1, len(lines)):
            if not lines[i].startswith("### "):
                continue
            name = lines[i][4:].strip()
            rows = read_table(lines, i + 1, "Attribute")
            self.anchors[name.lower()] = name
            known = self.schemas.setdefault(name, [])
            # A schema can be in several families. They come from one contract, the union covers any difference.
            for row in rows:
                if not any(k[0] == row[0] for k in known):
                    known.append(row)

    def schema_of_type(self, text, owner):
        """The schema names in a type cell"""
        names = []
        for target in re.findall(r"\]\(([^)]*)\)", text):
            anchor = target.split("#")[-1].lower()
            name = self.anchors.get(anchor)
            if name is None:
                self.problems.append(f"{owner}: no schema for the link {target}")
            else:
                names.append(name)
        return names

    def read_family(self, file, lines):
        title = next((line[2:].strip() for line in lines if line.startswith("# ")), file)
        starts = [i for i, line in enumerate(lines) if re.fullmatch(r"## [a-z][a-z0-9_]*", line)]
        ends = {}
        headings = [i for i, line in enumerate(lines) if line.startswith("## ")]
        for start in starts:
            ends[start] = next((h for h in headings if h > start), len(lines))
        for start in starts:
            section = lines[start:ends[start]]
            header = next((line for line in section if re.match(r"^`[A-Z]+ /", line)), None)
            if header is None:
                self.problems.append(f"{file}: {lines[start]} has no request line")
                continue
            self.families.append((title, lines[start][3:], header, section))


def attribute(reference, name, wire, text, required, owner, unions):
    """An option or attribute from the cells of its name, API name, type and required"""
    out = {"name": strip_code(name)}
    if strip_code(wire) != out["name"]:
        out["wire"] = strip_code(wire)
    schemas = reference.schema_of_type(text, owner)
    if len(schemas) == 1:
        out["schema"] = schemas[0]
    elif len(schemas) > 1:
        # `one of`: the checks accept the union of the variants
        out["schema"] = "_or_".join(schemas)
        unions[out["schema"]] = schemas
    elif text.startswith("integer"):
        out["type"] = "integer"
    elif text.startswith("number"):
        out["type"] = "number"
    elif text.startswith("boolean"):
        out["type"] = "boolean"
    elif text.startswith("string") or text.startswith("enum"):
        out["type"] = "string"
    else:
        # Arrays of scalars, maps and untyped objects take any value
        out["type"] = "any"
    if required == "yes":
        out["required"] = True
    return out


def read_paging(section, rows, columns):
    """The paging of a function from its note"""
    note = next((line[len("**Paging:** ") :] for line in section if line.startswith("**Paging:** ")), None)
    if note is None:
        return None
    for start, rule in PAGING_RULES:
        if note.startswith(start):
            return rule
    # A next value sits beside the rows
    parent = rows.rsplit("/", 1)[0] if rows else ""
    if "`next_page_url`" in note.split("(")[0] or "`next_page_url`" in note.split(". ")[0]:
        wire = next((c.get("wire", c["name"]) for c in columns if c["name"] == "next_page_url"), "nextPageUrl")
        return {"kind": "url", "from": f"{parent}/{wire}"}
    match = re.match(r"`page_token`, from `(\w+)`", note)
    if match:
        return {"kind": "token", "from": f"{parent}/{match.group(1)}", "option": "page_token"}
    match = re.match(r"`(batch_size|limit)`.*`offset`", note)
    if match:
        return {"kind": "offset", "option": "offset", "size": match.group(1), "start": 1 if "1-based" in note else 0}
    return "unknown:" + note


def read_function(reference, title, name, header, section, unions):
    match = re.match(r"^`([A-Z]+) (\S+)`(.*)$", header)
    method, path, tail = match.group(1), match.group(2), match.group(3)
    evidence = re.search(r"evidence ([OSDC])", tail)
    evidence = evidence.group(1) if evidence else None
    fn = {"name": name, "family": title, "method": method}

    host = re.search(r"host (core|tenant|connect)", tail)
    token = next((line for line in section if line.startswith("**Token:** Core Salesforce token")), None)
    if host:
        fn["host"] = host.group(1)
    elif token:
        fn["host"] = "core"
    else:
        fn["host"] = "tenant" if path.startswith("/api/") else "connect"
    fn["path"] = path

    options = []
    sensitive = []
    for row in read_table(section, 1, "Option"):
        option = attribute(reference, row[0], row[1], row[3], row[4], name, unions)
        where = row[2]
        placement = "path:" + (option.get("wire", option["name"])) if where == "path" else where
        ordered = {"name": option["name"]}
        if "wire" in option:
            ordered["wire"] = option["wire"]
        ordered["in"] = placement
        ordered.update({k: v for k, v in option.items() if k not in ("name", "wire")})
        options.append(ordered)
        if "(text/csv)" in row[3]:
            fn["body"] = "text/csv"
        if any("**Sensitive:**" in cell for cell in row[5:]):
            sensitive.append({"pointer": "/" + option["name"]})
        if option["name"] in CREDENTIAL_OPTIONS:
            sensitive.append({"pointer": f"/{option['name']}/*/value", "public_when": {"param_name": PUBLIC_CREDENTIAL_PARAMS}})
    if options:
        fn["options"] = options

    result = next((i for i, line in enumerate(section) if line == "**Result**"), None)
    rows = None
    columns = []
    if result is not None:
        summary = next((line for line in section[result + 1 :] if line.strip()), "")
        match = re.match(r"One row per item of `([^`]*)`", summary)
        if match:
            rows = "" if match.group(1) == "/" else match.group(1)
            fn["rows"] = rows
        for row in read_table(section, result + 1, "Column"):
            # A column per alias of the query only exists at runtime, it stays in `_raw`
            if strip_code(row[0]).startswith("<"):
                continue
            column = {"name": strip_code(row[0])}
            wire = strip_code(row[1])
            if wire != column["name"]:
                column["wire"] = wire
            column_type = row[2].split(" ")[0]
            if column_type not in COLUMN_TYPES:
                reference.problems.append(f"{name}: the column {column['name']} has the type {row[2]}")
            column["type"] = column_type
            columns.append(column)
    if columns:
        fn["columns"] = columns

    paging = read_paging(section, rows, columns)
    if isinstance(paging, str):
        reference.problems.append(f"{name}: can't read the paging note {paging}")
    elif paging is not None:
        fn["paging"] = paging
    if any("A 404 here can mean \"no mappings\"" in line for line in section):
        fn["errors"] = {"empty_on": [404]}
    if sensitive:
        fn["sensitive"] = sensitive
    fn["effect"] = "read" if "read-only" in tail else "write"
    # The contract is complete for its functions, the rest comes from tool sources and docs
    if evidence != "O":
        fn["unknown"] = "warning"
    if evidence is not None:
        fn["evidence"] = evidence
    return fn


def schema_attributes(reference, name, rows, unions):
    return [attribute(reference, row[0], row[1], row[2], row[3], name, unions) for row in rows]


def generate(directory):
    reference = Reference(directory)
    unions = {}
    functions = [read_function(reference, *family, unions) for family in reference.families]
    functions.sort(key=lambda f: f["name"])
    # The escape hatch, see docs/design/overlay.md
    functions.append(
        {
            "name": "request",
            "family": "Escape hatch",
            "raw": True,
            "host": "connect",
            "options": [
                {"name": "method", "type": "string", "required": True},
                {"name": "path", "type": "string", "required": True},
                {"name": "host", "type": "string"},
                {"name": "body", "type": "any"},
            ],
            "unknown": "allow",
        }
    )

    schemas = {}
    for name, rows in reference.schemas.items():
        attributes = schema_attributes(reference, name, rows, unions)
        schema = {}
        inferred = any("Seen in examples" in cell for row in rows for cell in row[4:])
        if not attributes:
            schema["unknown"] = "allow"
        elif inferred:
            schema["unknown"] = "warning"
        schema["attributes"] = attributes
        schemas[name] = schema

    # A schema that only functions outside the contract use may be incomplete as well
    used_by = {}

    def visit(schema_name, evidence, seen):
        if schema_name in seen or schema_name not in schemas:
            return
        seen.add(schema_name)
        used_by.setdefault(schema_name, set()).add(evidence)
        for attr in schemas[schema_name]["attributes"]:
            if "schema" in attr:
                visit(attr["schema"], evidence, seen)

    for name, variants in sorted(unions.items()):
        merged = []
        for variant in variants:
            for attr in schemas.get(variant, {}).get("attributes", []):
                if not any(m["name"].lower() == attr["name"].lower() for m in merged):
                    # An attribute is only required in its own variant
                    merged.append({k: v for k, v in attr.items() if k != "required"})
        schema = {"attributes": merged}
        if any(schemas.get(v, {}).get("unknown") == "warning" for v in variants):
            schema["unknown"] = "warning"
        schemas[name] = schema

    for fn in functions:
        for option in fn.get("options", []):
            if "schema" in option:
                visit(option["schema"], fn.get("evidence", "O"), set())
    for name, evidences in used_by.items():
        if "O" not in evidences and schemas[name].get("unknown") is None:
            schemas[name]["unknown"] = "warning"

    # Names that differ in case only are one name in a script, the first spelling wins
    def dedupe(owner, attributes):
        seen = {}
        out = []
        for attr in attributes:
            key = attr["name"].lower()
            if key in seen:
                if seen[key].get("wire", seen[key]["name"]) != attr.get("wire", attr["name"]):
                    reference.problems.append(f"{owner}: {attr['name']} has two API spellings")
                continue
            seen[key] = attr
            out.append(attr)
        return out

    for fn in functions:
        if "options" in fn:
            fn["options"] = dedupe(fn["name"], fn["options"])
    for name, schema in schemas.items():
        schema["attributes"] = dedupe(name, schema["attributes"])

    spec = {
        "format": 1,
        "namespace": "cdp",
        "title": "Salesforce Data 360",
        "hosts": HOSTS,
        "errors": ERRORS,
        "schemas": dict(sorted(schemas.items())),
        "functions": functions,
    }
    return spec, reference.problems


def is_flat(value):
    """Does a value fit one line?"""
    if isinstance(value, dict):
        return all(not isinstance(v, (dict, list)) or is_flat_leaf(v) for v in value.values())
    return False


def is_flat_leaf(value):
    if isinstance(value, list):
        return all(not isinstance(v, (dict, list)) for v in value)
    return False


def render(value, indent=0):
    """Pretty JSON with one line per option, attribute and column, so that a diff of the spec reads well"""
    pad = "  " * indent
    inner = "  " * (indent + 1)
    if is_flat(value) or not isinstance(value, (dict, list)) or is_flat_leaf(value):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        if not value:
            return "[]"
        return "[\n" + ",\n".join(inner + render(v, indent + 1) for v in value) + "\n" + pad + "]"
    if not value:
        return "{}"
    items = [inner + json.dumps(k) + ": " + render(v, indent + 1) for k, v in value.items()]
    return "{\n" + ",\n".join(items) + "\n" + pad + "}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", required=True)
    parser.add_argument("--write")
    parser.add_argument("--check")
    args = parser.parse_args()
    spec, problems = generate(args.reference)
    for problem in problems:
        print("problem:", problem, file=sys.stderr)
    if problems:
        return 1
    text = render(spec) + "\n"
    if args.write:
        with open(args.write, "w", encoding="utf-8") as out:
            out.write(text)
        attributes = sum(len(f.get("options", [])) for f in spec["functions"]) + sum(len(s["attributes"]) for s in spec["schemas"].values())
        print(f"{len(spec['functions'])} functions, {len(spec['schemas'])} schemas, {attributes} attributes, {len(text)} bytes")
    if args.check:
        with open(args.check, encoding="utf-8") as current:
            if current.read() != text:
                print(f"{args.check} is stale, run bazel run //overlay/d360:update", file=sys.stderr)
                return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
