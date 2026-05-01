## Setup External Client App

1. Go To Setup > External Client Apps
2. Enable OAuth Settings
    a. Callback URL: `https://dashql.app/oauth.html`
    b. Enable OAuth Scopes: api, cdp_api
3. Uncheck Require Secret for Web Server Flow
4. Save
5. Manage Consumer Details
6. Copy only the insensitive "Consumer Key", not the secret
7. Open "Data Cloud Setup" at least once in the UI otherwise `/services/a360/token` will return `instance_url: null`
8. For the instance URL, make sure to use the correct URL:
```
# Will work
https://orgfarm-fdd95295a3.test2.my.pc-rnd.salesforce.com


# Will NOT work
https://dsm000001gktt2au.sfdctest.test1.my.pc-rnd.salesforce.com
https://dsm000001gktt2au.sfdctest.test1.lightning.pc-rnd.force.com
https://orgfarm-fdd95295a3.test2.file.pc-rnd.force.com
```

# Setup CORS

1. Go To Setup > CORS
2. Add `https://dashql.app` and `http://localhost:9002`
3. Check "Enable CORS for OAuth endpoints"

# Auth Proxy

The web build cannot call `/services/oauth2/token`, `/services/oauth2/userinfo`,
or `/services/a360/token` directly because those endpoints do not emit CORS
headers. Run the bundled CORS proxy and point the Salesforce connection at it:

```
bazel run //packages/cors-proxy:proxy -- \
  --allow-forward-to "*.salesforce.com,*.force.com" \
  --listen 127.0.0.1:23333 \
  --allow-origin http://localhost:9002
```

`--allow-forward-to` takes a comma-separated list of host patterns. A leading
`*.` matches any subdomain (one or more labels); no other wildcard positions are
supported. The proxy reads the upstream origin from an `X-Forward-To` header on
each request and rejects any host not in the allowlist.

Then enter `http://127.0.0.1:23333` as the "Auth Proxy URL" on the Salesforce
connection settings page. All OAuth calls against the Salesforce instance go
through the proxy; Data Cloud requests (metadata, query) go direct. The native
build ignores this field.
