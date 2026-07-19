## Local development

Get yourself a hyperd from the Tableau Hyper API, then launch hyperd with:

```
hyperd run \
    --listen-connection tcp.grpc://localhost:7484 \
    --skip-license \
    --no-password \
    --init-user tableau_internal_user \
    --log_config=cerr,json,all

```

## Building docker image

We are re-packaging the hyperd binary shipped with the Tableau HyperAPI as Docker image under ankoh/hyperdb.

```
# Build the Hyper docker image as `ankoh/hyperdb:<hyperapi-version>
bazel run //packages/hyper-docker:load_image

# Also tag the version as latest
docker tag ankoh/hyperdb:0.0.25080 ankoh/hyperdb:latest

# Push the new version to the remote
docker push ankoh/hyperdb:0.0.25080
docker push ankoh/hyperdb:latest
```

### One-off image with a custom hyperd

To bake in a locally built hyperd instead of the wheel binary, point `HYPERD_BINARY`
at an absolute path. The image is tagged `ankoh/hyperdb:<hyperapi-version>-dev.g<sha>`
(short git SHA) so it can never be mistaken for a release build.

```
HYPERD_BINARY=/abs/path/to/hyperd bazel run //packages/hyper-docker:load_image
```

## Docker image

Run as shell:
```
docker run -it --rm \
      --platform linux/amd64 \
      -v /tmp/hyperdb/data:/data \
      ankoh/hyperdb:latest shell \
      --no-password \
      --skip-license=1 \
      --init-user=tableau_internal_user \
      --log_config=file,json,all,/data/hyperd,86400
```

Run as server:
```
docker run -it --rm -p 7484:7484 \
      --platform linux/amd64 \
      -v /tmp/hyperdb/data:/data \
      --log-driver json-file \
      --log-opt max-size=10m \
      --log-opt max-file=3 \
      ankoh/hyperdb:latest run \
      --no-password \
      --skip-license=1 \
      --init-user=tableau_internal_user \
      --log_config=cerr,json,all \
      --listen-connection tcp.grpc://0.0.0.0:7484
```

## Other flags

```
# For R2 support, run with:
--external_allow_custom_endpoints=1
```
