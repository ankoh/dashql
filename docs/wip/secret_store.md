# Secret store

Status: an idea, deferred. Nothing here is built.

An app-wide key-value store, whose keys scripts read as scalar parameters. It's a tool to use in place of a normal scalar parameter, so nothing is classified as secret and a key can go wherever a parameter can.

```sql
CALL cdp.connection_create (
  connector_type => 'SNOWFLAKE',
  label => 'Snowflake prod',
  name => 'SnowflakeConn',
  method => 'Ingress',
  credentials => [
    (param_name = 'authenticationOption', value = 'KeyPair'),
    (param_name = 'user', value = :snowflake_user),
    (param_name = 'privateKey', value = :snowflake_private_key)
  ]
);
```

## Scalar parameters today

See [Session Inputs](../design/session_inputs.md).

- `:name` uses a parameter, in a query or in a `CALL`.
- `@param :name = <literal>` in a comment holds its value. `@param :name` leaves it unset.
- The named parameters of a session's scripts are its inputs, shown as cards. A changed card writes the value into the `@param` tag of every script that uses it, also when a script is exported.
- A script binds the value of its own tag, and the value of the session otherwise.
- The planner inlines the value as a literal, so it's in the SQL text sent to a backend and in the query history. The signature of a script holds it as well (`:min=10`), and so do its result keys.
- `CALL` of an overlay gets a null plus a binding from the core, and the runtime fills in the value from `env.params`.

## With a store

A script's value still comes first. The store is the last place to look:

1. The script's own `@param` tag.
2. The value of the session.
3. The secret store.

A value from the script or the session shadows a key of the same name, and that shows a warning.

**The UI** is a dedicated tab in the internals overlay, with the `shield_lock_24` icon. It's a list of keys and values.

## Open questions

- **Where the values live.** Nothing in the app stores secrets yet. Electron has `safeStorage`, while a browser has no keychain: encrypted IndexedDB only protects against reading the stored data, not against code running in the page.
- **What inlining exposes.** A key used in plain SQL reaches the backend, the query history and the signature of the script, like any parameter.
- **Shared scripts.** A script from someone else can name a key of yours, and the same goes for a key that happens to match a parameter such as `:region`.
- **Input cards.** A card for a store-backed parameter shouldn't show the value, and typing into it would write the value into a `@param` tag.
- **What the core knows.** Names would be enough for completion and the shadow warning, so values never have to reach it.
