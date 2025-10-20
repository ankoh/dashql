#!/usr/bin/env python3

from tableauhyperapi import HyperProcess, Telemetry, Connection
import os
import re
from pathlib import Path
import json
import xml.etree.ElementTree as ET
from collections import defaultdict

SCRIPT_DIR = Path(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = Path(os.path.dirname(SCRIPT_DIR))
SNAPSHOTS_DIR = ROOT_DIR / "snapshots" / "plans" / "hyper"
SETUP_FILE = SNAPSHOTS_DIR / "setup" / "setup.sql"
QUERIES_DIR = SNAPSHOTS_DIR / "queries"
OUTPUT_DIR = SNAPSHOTS_DIR / "tests"

hyper_params = {
    "log_config": ""
}

def read_file(p):
    with open(p) as f:
        return f.read()

def write_xml_template(folder_name, snapshots):
    output_file = OUTPUT_DIR / f"{folder_name}.tpl.xml"

    root = ET.Element("plan-snapshots")

    for filename, plan_json in snapshots.items():
        snapshot = ET.SubElement(root, "plan-snapshot")
        snapshot.set("name", re.sub(r"[-.]", "_", filename))
        input_element = ET.SubElement(snapshot, "input")
        input_element.text = f"\n            {plan_json}\n        "

    ET.indent(root, space="    ")
    tree = ET.ElementTree(root)

    with open(output_file, 'wb') as f:
        tree.write(f, encoding='utf-8', xml_declaration=False)

    print(f"[ OUTPUT ] Written {output_file}")

with HyperProcess(telemetry=Telemetry.DO_NOT_SEND_USAGE_DATA_TO_TABLEAU, parameters=hyper_params) as hyper:
    with Connection(endpoint=hyper.endpoint) as connection:
        # Run setup script
        setupSql = read_file(SETUP_FILE)
        for stmt in setupSql.split(";"):
            print(f"[ HYPER ] Execute setup statement")
            connection.execute_command(stmt)

        # Group files by folder
        folder_snapshots = defaultdict(dict)

        # Dump the plans
        for f in QUERIES_DIR.glob("**/*.sql"):
            # A) first-level subfolder (relative to QUERIES_DIR)
            folder = f.relative_to(QUERIES_DIR).parts[0]
            # B) file name
            filename = f.name

            print(f"[ HYPER ] Processing dir={folder} file={filename}")

            sql = read_file(f)

            result = connection.execute_list_query("EXPLAIN (FORMAT JSON) " + sql)
            plan = ""
            for r in result:
                plan += str(r[0])
                plan += "\n"

            # Parse and format the JSON plan (condensed)
            try:
                plan_obj = json.loads(plan.strip())
                plan_json = json.dumps(plan_obj, separators=(',', ':'))
            except json.JSONDecodeError:
                # If it's not valid JSON, use the raw plan
                plan_json = plan.strip()

            # Store in folder group
            folder_snapshots[folder][filename] = plan_json

        # Write XML template files for each folder
        for folder_name, snapshots in folder_snapshots.items():
            write_xml_template(folder_name, snapshots)
