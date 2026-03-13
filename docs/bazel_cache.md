
We run a BuildBuddy server at `buildbuddy.dashql.app`.
BuildBuddy is a Bazel Cache server that is open core.
Unfortunately, authentication fell out as enterprise feature which makes it a bit awkward to work with.

We tried Basic auth proxied through nginx, doesn't work properly.
We tried mTLS by BuildBuddy, but it didn't reject anonymous client good enough.
We therefore went with proxied mTLS through nginx again.


# Operational

```
# Generate CA, client and server certificates for mTLS
bazel run //scripts:generate_cache_certificates

# Rsync docker compose config to the cache server
bazel run //scripts:configure_cache_server

# Dump settings that we require as GitHub secrets (c.f. setup-bazel/action.yaml)
bazel run //scripts:dump_github_cache_entries
```


# Firewall

Configure Hetzner Firewall as well as ufw to restrict to 22, 443 and 1986.

```
sudo ufw allow 22/tcp
sudo ufw allow 443/tcp
sudo ufw allow 1986/tcp
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
```
