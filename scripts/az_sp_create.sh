#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

az ad sp create-for-rbac \
    --name "dashql-app-ci" \
    --skip-assignment true

