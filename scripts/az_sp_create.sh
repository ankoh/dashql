#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

az ad sp create-for-rbac \
    --name "dashql-app-ci" \
    --skip-assignment true

