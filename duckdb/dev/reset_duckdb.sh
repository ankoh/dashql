#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)/.."
DUCKDB_ROOT=${PROJECT_ROOT}/submodules/duckdb

rm -rf ${DUCKDB_ROOT}/src/amalgamation/*
rm -rf ${DUCKDB_ROOT}/build/*
