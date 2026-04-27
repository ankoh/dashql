
## General Signing

We use a simple Ed25519 key pair for signing our own binaries.
https://jedisct1.github.io/minisign/

They are passed to Tauri via TAURI_SIGNING_PRIVATE_KEY & TAURI_SIGNING_PRIVATE_KEY_PASSWORD.

## MacOS Signing

We need only two things for MacOS signing:

A certificate of type "Developer ID Application" to sign our applications:
Can be created here: https://developer.apple.com/account/resources/certificates/list

Provided through: (VAult "DashQL Developer ID Application")
- MACOS_SIGNING_IDENTITY -> "Signing Identity"
- MACOS_DEVELOPER_ID_APPLICATION_BASE64 -> "base64"
- MACOS_DEVELOPER_ID_APPLICATION_SECRET -> "password"

An API key to access the AppStoreConnect Api.
Can be created here: https://appstoreconnect.apple.com/access/integrations/api

Provided through: (Vault "DashQL AppStoreConnect CI")
- MACOS_STORE_ISSUER_ID -> "Issuer ID"
- MACOS_STORE_KEY_ID -> "Key ID"
- MACOS_STORE_KEY -> "AuthKey"
- APPLE_API_KEY_PATH


## Create signed universal apps

Find your signing identity using:
```
security find-identity -v -p codesigning
```

Create a local .bazelrc.user file with the following content:
```
build:sign --action_env=APPLE_SIGNING_IDENTITY="Developer ID Application: XX"
```

Then build signed artifacts using:
```
bazel build --config=release --config=sign //packages/dashql-native:mac_universal_dmg_signed
bazel build --config=release --config=sign //packages/dashql-native:mac_universal_updater_bundle_signed
```

Make sure codesigning worked using:
```
codesign -vvv --verify ./bazel-bin/packages/dashql-native/DashQL-universal-signed.app
codesign -vvv --verify ./bazel-bin/packages/dashql-native/mac_universal_dmg_signed_src/DashQL.app
```
