
## Architecture

```
internet → nginx (80/443/1986)   [jonasal/nginx-certbot]
               │  TLS termination (Let's Encrypt / ACME)
               │  basic auth (htpasswd)
               ├─ HTTPS  → buildbuddy:8080  (web UI + HTTP cache)
               └─ gRPCS  → buildbuddy:1985  (Bazel remote cache/execution)
```

## docker-compose.env

Create `docker-compose.env` (gitignored) with:

```dotenv
POSTGRES_IMAGE_TAG=17
POSTGRES_USER=buildbuddy
POSTGRES_PASSWORD=<secret>
POSTGRES_DB=buildbuddy
BUILDBUDDY_IMAGE_TAG=v2.250.0
NGINX_CERTBOT_IMAGE_TAG=6.1-alpine
CERTBOT_EMAIL=<admin-email>
```

## Basic auth credentials

Generate `nginx/htpasswd` (gitignored) before the first start:

```sh
# Requires apache2-utils (Debian/Ubuntu) or httpd-tools (RHEL).
htpasswd -c ./htpasswd <username>
```

Add further users (omit `-c` to append):

```sh
htpasswd ./htpasswd <another-user>
```

Then encode `user:pw` as base64
```
echo -n "user:YOUR_API_KEY_HERE" | base64
```

And then send that base64 as auth header through BAZEL_AUTH_HEADER

```
--remote_header="Authorization=Basic <base64>"
```


## Setup

Make sure ports 80 and 443 are reachable from the internet before starting (required for
ACME certificate issuance). `jonasal/nginx-certbot` handles certificate provisioning and
renewal automatically.

```sh
docker compose --env-file docker-compose.env pull
docker compose --env-file docker-compose.env up -d
```

## Bazel remote cache URL

```
--remote_cache=grpcs://buildbuddy.dashql.app:1985
--remote_header=Authorization="Basic $(printf 'user:pass' | base64)"
```


