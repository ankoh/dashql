
We run a `bazel-remote` server at `bazel-cache.dashql.app`.
We tried FOSS BuildBuddy, but it was painful.
We just setup `bazel-remote` with mTLS and mark that topic done.


# Operational

```
# Generate CA, client and server certificates for mTLS
bazel run //infra/bazel-cache:generate_cache_certificates

# Rsync docker compose config to the cache server
bazel run //infra/bazel-cache:configure_cache_server

# Dump settings that we require as GitHub secrets (c.f. .github/actions/setup-bazel/action.yml)
bazel run //infra/bazel-cache:github_secrets
```


# Firewall

Configure Hetzner Firewall as well as ufw to restrict to 22 (SSH), 80 and 443 (Caddy, Grafana) and 9092 (bazel-remote gRPC).

```
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw allow 9092/tcp
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
sudo ufw status numbered
```
