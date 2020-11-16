#!/bin/bash

multipass launch \
    -vvvv \
    --cpus 4 \
    --disk 20G \
    --mem 6G \
    --name github-action-runner \
    --cloud-init ./cloud-init.yaml

