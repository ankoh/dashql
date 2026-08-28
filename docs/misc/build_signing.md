
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


## Create signed Electron apps

Find your signing identity using:
```
security find-identity -v -p codesigning
```

Export the identity before invoking the package target:
```
export CSC_NAME="Developer ID Application: XX"
```

Then build signed artifacts using:
```

CI uses `CSC_LINK` and `CSC_KEY_PASSWORD` for the Developer ID certificate. It
also provides `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` so
electron-builder submits each architecture-specific package for notarization.
bazel run --config=release //packages/dashql-electron:mac_package_arm64
bazel run --config=release //packages/dashql-electron:mac_package_x86_64
```

Make sure codesigning worked using:
```
codesign -vvv --verify ./dist/electron/arm64/mac-arm64/DashQL.app
codesign -vvv --verify ./dist/electron/x64/mac/DashQL.app
```
