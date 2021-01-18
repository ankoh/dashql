#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

az ad sp list \
    --filter "startswith(displayname, 'dashql')"

