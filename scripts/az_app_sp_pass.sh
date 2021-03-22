#!/usr/bin/env bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

az ad sp credential reset --name 'dashql-app-ci'
