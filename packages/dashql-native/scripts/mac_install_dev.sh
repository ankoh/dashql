#!/bin/bash
set -e

APP_SRC="$1"
APP_DST="$HOME/Applications/DashQL-Dev.app"

echo "Installing $APP_SRC to $APP_DST"
rm -rf "$APP_DST"
cp -R "$APP_SRC" "$APP_DST"
echo "✓ Installed DashQL-Dev.app to ~/Applications"
