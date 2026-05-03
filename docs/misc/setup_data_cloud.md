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

# Work around CORS problems

The CORS is still problematic for the offcore Data 360 token exchange.
We have a dedicated `hyper-http-proxy` that bypasses CORS and translates V3 HTTP to V3 GRPC.

Run it locally with an allowlist that covers both the OAuth/login hosts and
the Data Cloud instance hosts Salesforce returns in token responses:

```
bazel run //packages/hyper-http-proxy:proxy -- \
  --listen 127.0.0.1:9100 \
  --allow-origin http://localhost:9002 \
  --allow-forward-to '*.salesforce.com,*.force.com'
```

Then enter `http://127.0.0.1:9100` as the "HTTP Proxy URL" on the Salesforce
connection settings page. All connection HTTP traffic goes through the proxy:
OAuth / token exchange / Data Cloud metadata calls carry an `Dashql-Forward-To`
header naming the real Salesforce host, while the `/api/v3/query*` HTTP v3 calls
carry `Dashql-Grpc-Endpoint` so the proxy translates them to the Hyper gRPC API.
