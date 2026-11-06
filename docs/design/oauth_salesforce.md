# Salesforce OAuth Flow

DashQL uses the [Web Server OAuth Flow with PKCE](https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm&type=5).
No client secret is embedded; PKCE alone binds the initiator to the finisher.

Core OAuth access tokens may be opaque. DashQL exchanges the Core token for a separate
Data Cloud JWT; named-user OrgJWT access tokens are not required.
See [External Client App setup](../misc/setup_data_cloud.md).

The registered `redirect_uri` is the configured `auth.oauthRedirect`, `https://dashql.app/oauth.html` in
`static/config.json`, wherever the app is running. That page acts as a relay: it receives the authorization
code from Salesforce, encodes it into an app event, and hands it back to the originating app instance.

---

## Shared setup (all paths)

`authenticateSalesforce` (`connections/salesforce/salesforce_authentication.ts`) runs these steps. It is
called by the connection setup (`salesforce_connection_setup.ts`) and by the shell.

1. Generate a PKCE challenge (`code_verifier` + `code_challenge` via S256).
2. Choose `flowVariant` based on platform type:
   - `WEB_OPENER_FLOW` — `PlatformType.WEB`, i.e. the web app, including the localhost dev server
   - `NATIVE_LINK_FLOW` — otherwise, i.e. the Electron desktop app
3. Serialise the `OAuthState` (`oauth/oauth_types.ts`) → JSON → base64url → `state` query param:
   ```
   OAuthState {
     flowId,                // random UUID of this flow
     flowVariant,
     debugMode,             // debug build
     callbackUrl?,          // WEB_OPENER_FLOW only: {origin of the app}/oauth.html
     flavor?,               // brands the redirect page
     salesforceProvider: { instanceUrl, appConsumerKey, requestedAt, expiresAt },  // expiresAt = requestedAt + 2 h
   }
   ```
4. Build the Salesforce authorization URL (`buildSalesforceAuthorizationUrl`):
   ```
   {instanceUrl}/services/oauth2/authorize
     ?client_id={appConsumerKey}
     &redirect_uri={auth.oauthRedirect}
     &code_challenge={pkceChallenge}
     &code_challenge_method=S256
     &response_type=code
     &state={base64url-OAuthState}
     [&prompt=login]        // forced re-login
     [&login_hint={login}]  // login of the connection
   ```
5. Open the URL (mechanism differs per path — see below).
6. Call `appEvents.waitForOAuthRedirect(abortSignal, accepts)` and suspend until a redirect with the
   `flowId` of this flow arrives.

After the redirect arrives:

7. Validate it (`validateSalesforceOAuthCallbackState`): the `flowId`, `flowVariant`, `instanceUrl`,
   `appConsumerKey` and `expiresAt` must match the state that was sent, and the state must not have
   expired. An OAuth `error` of the redirect fails the setup with its `errorDescription`, a redirect without
   `code` fails too.
8. Exchange the code for a core access token: POST to `{instanceUrl}/services/oauth2/token`
   with `code`, `code_verifier`, and the configured `redirect_uri`. Then read the Core user info; a failure
   there is logged and ignored.
9. POST to the Core token response's `{instance_url}/services/a360/token` with
   `grant_type=urn:salesforce:grant-type:external:cdp`, `subject_token={coreAccessToken}`,
   and `subject_token_type=urn:ietf:params:oauth:token-type:access_token`.
10. Decode the exchanged Data Cloud JWT. The connection speaks Hyper over HTTP (`V3_HTTP`) to the exchange
    response's `instance_url`; every request carries the Data Cloud JWT unchanged as bearer token and its
    `audienceTenantId` as `audience`. The SIDB connector additionally attaches `hyper.cloud:{databaseName}`
    as `lakehouse` (`getSidbAttachedDatabase`). Read the selected dataspace from
    `customAttributes.data.dataspace` (or the flat `customAttributes.dataspace`), falling back to
    `default`. Keep the Core token and its `instance_url` for Core REST user info and metadata;
    metadata requests use the dataspace from the Data Cloud token.

JWT decoding does not verify signatures; the receiving Salesforce service does that.
No manual Data Cloud endpoint or tenant parameters are needed. The app does not
currently refresh credentials automatically; reconnect when the tokens expire.

---

## Redirect page

`oauth.html` loads `oauth/oauth_redirect.tsx`. `RedirectPage` decodes `state` and validates it
(`validateOAuthRedirectState`: a `flowId`, a known `flowVariant`, a complete Salesforce provider, not
expired). If the state carries a `callbackUrl` on another origin, the page first forwards itself there (see
Path B). Otherwise `OAuthSucceeded` encodes
`AppEventData { oauthRedirect: { code, error, errorDescription, state } }` (see Event encoding) and, after
a 2-second delay, `triggerFlow` hands it back as the flow variant says. The page shows "Authorization
Failed" with the description when Salesforce returned an `error`.

---

## Path A: `dashql.app` → `oauth.html` → `dashql.app`

`flowVariant = WEB_OPENER_FLOW`

```
dashql.app                Salesforce               dashql.app/oauth.html
    |                         |                             |
    |--- open popup --------->|                             |
    |    (authorization URL)  |                             |
    |                         |<-- user authenticates ------|
    |                         |--- redirect --------------->|
    |                         |    ?code=...&state=...      |
    |                         |                             |--- React loads
    |                         |                             |    validates state
    |                         |                             |    builds AppEventData
    |<-- BroadcastChannel ----+-----------------------------|
    |    "dashql_oauth"       |                             |
    |<-- opener.postMessage --+-----------------------------| (fallback, if window.opener survived)
    |                         |                             |--- window.close()
    |--- token exchange ------>
```

1. `window.open(url, 'DashQL OAuth', 'width=600,height=700,...')` opens a popup, or the setup reuses the popup
   that the caller opened beforehand (the login dialog of the shell).
2. Salesforce redirects the popup to `https://dashql.app/oauth.html?code=xxx&state=base64url`.
3. The redirect page validates the state and builds the event.
4. `triggerFlow` posts the event on the `BroadcastChannel` `dashql_oauth`. COOP
   (`Cross-Origin-Opener-Policy: same-origin`) severs `window.opener` once the popup navigated to
   Salesforce, the same-origin channel works regardless. If `window.opener` is still there, it also gets
   `postMessage({ kind: 'dashql:app_event', data: eventBase64 }, window.location.origin)`. The popup then
   closes itself.
5. `WebPlatformEventListener` receives the channel message, or a `message` event with that envelope from
   its own origin (`processMessageEvent`), and passes it through `readAppEvent → dispatchAppEvent →
   dispatchOAuthRedirect`, which resolves `waitForOAuthRedirect`.
6. If neither arrives, the page shows the event data with a copy button; pasting it into the app delivers
   it (see Pasting).

---

## Path B: `localhost` (dev server) → `oauth.html` → `localhost`

`flowVariant = WEB_OPENER_FLOW`, as in Path A; the platform is still `PlatformType.WEB`.

The popup is opened from `localhost` with `callbackUrl = http://localhost:<port>/oauth.html`, and
Salesforce redirects it to `dashql.app/oauth.html`. Since the callback is on another origin, the redirect
page checks it with `isAllowedOAuthCallbackUrl` (`oauth/oauth_redirect_utils.ts`): the path must be
`/oauth.html` without query, hash or credentials, and the origin must be the page's own, `https://dashql.app`,
`https://stable.dashql.app`, `https://hyperdb.sh`, or `http(s)` on `localhost` or `127.0.0.1`. Other callbacks
fail. `stable.dashql.app` and `hyperdb.sh` take this path too, their logins pass through
`dashql.app/oauth.html`. An allowed callback gets the query of the redirect (`code`, `state`, `error`, ...) and replaces the location of the popup. The
`oauth.html` of the dev server then continues as in Path A, its BroadcastChannel is same-origin with the
app.

---

## Path C: Native app → `oauth.html` → Native app

`flowVariant = NATIVE_LINK_FLOW`

```
Native app (Electron)     Salesforce            System browser            OS deep-link
    |                         |                      |                         |
    |--- openExternal(url) -->|                      |                         |
    |                         |<-- user authenticates|                         |
    |                         |--- redirect -------->|                         |
    |                         |    ?code=...&state=..|                         |
    |                         |                      |--- React loads          |
    |                         |                      |    validates state      |
    |                         |                      |    builds AppEventData  |
    |                         |                      |--- window.open -------->|
    |                         |                      |    dashql://localhost   |
    |<------------------------------------------------------------ Electron deep-link event
    |                         |
    |--- token exchange ------>
```

1. The preload bridge's `openExternal(url)` (`shell.openExternal` in main) opens the authorization URL in
   the system browser, outside the app window.
2. Salesforce redirects the browser to `https://dashql.app/oauth.html?code=xxx&state=base64url`.
3. `oauth.html` loads `oauth_redirect.tsx` inside the **system browser**.
4. `RedirectPage` decodes and validates `state` → `OAuthState` with `flowVariant = NATIVE_LINK_FLOW`.
5. `OAuthSucceeded` encodes `AppEventData` as before.
6. After a 2-second delay, `triggerFlow` calls `window.open("dashql://localhost?data=eventBase64", '_self')`.
   - The OS routes the `dashql://` deep link to the registered Electron app.
   - An "Open in App" button lets the user retry until the code expires, a copy button copies the link.
7. `ElectronPlatformEventListener` receives the deep link through the preload bridge, calls `readAppEvent → dispatchAppEvent → dispatchOAuthRedirect`, resolving `waitForOAuthRedirect`.
   - On cold start, Electron queues command-line and `open-url` deep links until the renderer requests them.

### Debug mode

When the native app is running in `debugMode` (dev server cannot register as deep-link handler):

- Auto-trigger is skipped entirely.
- `oauth.html` renders the full `dashql://localhost?data=...` deep link as a copyable text field.
- The user pastes it anywhere in the app window (see Pasting).

---

## Pasting

`processClipboardEvent` in `PlatformEventListener` intercepts pastes anywhere in the app. `parseClipboardSetup`
accepts `dashql://localhost`, `https://dashql.app` and `http://localhost:9002` links and takes their `data`
param; text that is plain base64url is taken as event data itself (the Path A fallback). The event is
dispatched like any other; other pastes go to the fallback paste subscribers, or to the focused element
when there are none.

---

## Event encoding

All paths share the same wire format for the event passed back to the app:

```
AppEventData { oauthRedirect: { code?, error?, errorDescription?, state: OAuthState } }
  → JSON
  → UTF-8 bytes
  → base64url string
```

`PlatformEventListener.readAppEvent` decodes this on receipt. Messages that are not valid
base64url, or that don't parse as `AppEventData`, are silently dropped. `waitForOAuthRedirect` ignores
redirects whose `flowId` is not the one it waits for.

---

## Comparison table

| | `dashql.app` | `localhost` | Native |
|---|---|---|---|
| `flowVariant` | `WEB_OPENER_FLOW` | `WEB_OPENER_FLOW` | `NATIVE_LINK_FLOW` |
| URL opened via | `window.open` (popup) | `window.open` (popup) | `openExternal` (system browser) |
| Redirect page | `dashql.app/oauth.html` | `dashql.app/oauth.html`, forwarded to `localhost/oauth.html` | `dashql.app/oauth.html` |
| Code returned via | `BroadcastChannel`, `window.opener.postMessage` fallback | `BroadcastChannel`, `window.opener.postMessage` fallback | `dashql://` deep link |
| Event received by | `WebPlatformEventListener` | `WebPlatformEventListener` | `ElectronPlatformEventListener` |
| Manual fallback | Paste event data into app | Paste event data into app | Paste deep link into app (debug mode) |
| `redirect_uri` | `auth.oauthRedirect` | `auth.oauthRedirect` | `auth.oauthRedirect` |
