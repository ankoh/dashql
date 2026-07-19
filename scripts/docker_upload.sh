#!/bin/bash

# Helper script to upload a docker image without fully swapping accounts
export DOCKER_CONFIG="$(mktemp -d)"

# Log in to the *isolated* config only (writes base64 into $DOCKER_CONFIG/config.json,
# not your keychain — because the empty config has no credsStore)
echo "$DOCKERHUB_PAT" | docker login -u ankoh --password-stdin

docker push ankoh/hyperdb:0.0.25080-dev.g662558637

# cleanup
rm -rf "$DOCKER_CONFIG"
unset DOCKER_CONFIG
