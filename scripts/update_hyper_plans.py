#!/usr/bin/env python3

from tableauhyperapi import HyperProcess, Telemetry, Connection
import os
from pathlib import Path

SCRIPT_DIR = Path(os.path.dirname(os.path.abspath(__file__)))
ROOT_DIR = Path(os.path.dirname(SCRIPT_DIR))
SNAPSHOTS_DIR = ROOT_DIR / "snapshots" / "planviewmodel" / "hyper"
SETUP_FILE = SNAPSHOTS_DIR / "setup" / "setup.sql"
QUERIES_DIR = SNAPSHOTS_DIR / "queries"
OUTPUT_DIR = SNAPSHOTS_DIR / "tests"

hyper_params = {
    "log_config": ""
}

def read_file(p):
    with open(p) as f:
        return f.read()

with HyperProcess(telemetry=Telemetry.DO_NOT_SEND_USAGE_DATA_TO_TABLEAU, parameters=hyper_params) as hyper:
    with Connection(endpoint=hyper.endpoint) as connection:
        # Run setup script
        setupSql = read_file(SETUP_FILE)
        for stmt in setupSql.split(";"):
            print(f"[ HYPER ] Execute setup statement")
            connection.execute_command(stmt)

        # Dump the plans
        for f in QUERIES_DIR.glob("**/*.sql"):
            # A) first-level subfolder (relative to QUERIES_DIR)
            folder = f.relative_to(QUERIES_DIR).parts[0]
            # B) file name
            filename = f.name

            print(f"[ HYPER ] dir={folder} file={filename}")

            sql = read_file(f)

            result = connection.execute_list_query("EXPLAIN (FORMAT JSON) " + sql)
            plan = ""
            for r in result:
                plan += str(r[0])
                plan += "\n"

            print(plan)
