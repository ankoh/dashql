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
