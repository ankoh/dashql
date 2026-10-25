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

## Other flags

```
# For R2 support, run with:
--external_allow_custom_endpoints=1
```

## DashQL UI

```
hyperd run --ui --skip-license --no-password --init-user tableau_internal_user
```

`--ui` starts an HTTP v3 listener on `127.0.0.1:7484` and prints two links, to dashql.app and to the native app
(`dashql://`), that run new sessions on this hyperd.
See `docs/design/hyper_links.md` for the link format, the contract that hyperd implements and the behavior of the app.
