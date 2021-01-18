#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

az ad sp list \
    --filter "startswith(displayname, 'dashql')"

