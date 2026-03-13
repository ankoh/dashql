#!/usr/bin/env bash
set -euo pipefail

DEST="${BUILD_WORKSPACE_DIRECTORY}/infra/bazel-cache/mtls"
DOMAIN="buildbuddy.dashql.app"
CA_DAYS=3650
LEAF_DAYS=397 # Safari/macOS max limit is 398 days
PREFIX="dashql-cache-"

mkdir -p "$DEST"

echo "Generating mTLS certificates in: $DEST"
echo ""

# ---------------------------------------------------------------------------
# 1. Certificate Authority
# ---------------------------------------------------------------------------

echo "[1/3] Generating CA key and self-signed certificate..."

openssl genrsa -out "$DEST/${PREFIX}ca.key" 4096

# Create a config for the CA to strictly enforce basicConstraints
cat > "$DEST/${PREFIX}ca.cnf" <<EOF
[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_ca
prompt = no

[req_distinguished_name]
CN = DashQL Cache CA
O = DashQL
C = DE

[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, digitalSignature, cRLSign, keyCertSign
EOF

openssl req -new -x509 -sha256 \
    -days $CA_DAYS \
    -key "$DEST/${PREFIX}ca.key" \
    -out "$DEST/${PREFIX}ca.crt" \
    -config "$DEST/${PREFIX}ca.cnf"

# ---------------------------------------------------------------------------
# 2. Server certificate (signed by CA, with SAN for the domain)
# ---------------------------------------------------------------------------

echo "[2/3] Generating server key and certificate..."

openssl genrsa -out "$DEST/${PREFIX}server.key" 4096

openssl req -new -sha256 \
    -key "$DEST/${PREFIX}server.key" \
    -out "$DEST/${PREFIX}server.csr" \
    -subj "/CN=${DOMAIN}/O=DashQL/C=DE"

cat > "$DEST/${PREFIX}server.cnf" <<EOF
[v3_req]
subjectAltName = DNS:${DOMAIN}
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF

openssl x509 -req -sha256 \
    -days $LEAF_DAYS \
    -in "$DEST/${PREFIX}server.csr" \
    -CA "$DEST/${PREFIX}ca.crt" \
    -CAkey "$DEST/${PREFIX}ca.key" \
    -CAcreateserial \
    -out "$DEST/${PREFIX}server.crt" \
    -extfile "$DEST/${PREFIX}server.cnf" \
    -extensions v3_req

# ---------------------------------------------------------------------------
# 3. Client certificate (signed by CA, for Bazel remote cache auth)
# ---------------------------------------------------------------------------

echo "[3/3] Generating client key and certificate..."

openssl genrsa -out "$DEST/${PREFIX}client.key" 4096

openssl req -new -sha256 \
    -key "$DEST/${PREFIX}client.key" \
    -out "$DEST/${PREFIX}client.csr" \
    -subj "/CN=DashQL Cache Client/O=DashQL/C=DE"

cat > "$DEST/${PREFIX}client.cnf" <<EOF
[v3_req]
keyUsage = critical, digitalSignature
extendedKeyUsage = clientAuth
EOF

openssl x509 -req -sha256 \
    -days $LEAF_DAYS \
    -in "$DEST/${PREFIX}client.csr" \
    -CA "$DEST/${PREFIX}ca.crt" \
    -CAkey "$DEST/${PREFIX}ca.key" \
    -CAcreateserial \
    -out "$DEST/${PREFIX}client.crt" \
    -extfile "$DEST/${PREFIX}client.cnf" \
    -extensions v3_req

# ---------------------------------------------------------------------------
# 4. PKCS#12 bundle for Mac Keychain import (client cert + key + CA chain)
# ---------------------------------------------------------------------------

openssl pkcs12 -export \
    -in "$DEST/${PREFIX}client.crt" \
    -inkey "$DEST/${PREFIX}client.key" \
    -certfile "$DEST/${PREFIX}ca.crt" \
    -out "$DEST/${PREFIX}client-bundle.p12" \
    -passout pass:""

# Clean up intermediary files
rm -f "$DEST/${PREFIX}server.csr" "$DEST/${PREFIX}server.cnf" "$DEST/${PREFIX}server.srl" \
      "$DEST/${PREFIX}client.csr" "$DEST/${PREFIX}client.cnf" "$DEST/${PREFIX}ca.srl" "$DEST/${PREFIX}ca.cnf"

echo ""
echo "Done."
