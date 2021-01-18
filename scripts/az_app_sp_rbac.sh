#!/bin/bash
# Copyright (c) 2020 The DashQL Authors

set -euo pipefail

STORAGE_RG="rg-dashql"
STORAGE_ACCOUNT="stdashql"
SUBSCRIPTION_ID=`az account show --query id --output tsv`

SCOPE_RG="/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${STORAGE_RG}"
SCOPE_ST="${SCOPE_RG}/providers/Microsoft.Storage/storageAccounts/${STORAGE_ACCOUNT}"
SCOPE_CONT="${SCOPE_ST}/blobServices/default/containers"

APP_CI_OID=$(az ad sp list --filter "displayname eq 'dashql-app-ci'" --query "[0].objectId" | tr -d '"')

az role assignment create \
    --assignee-object-id "${APP_CI_OID}" \
    --assignee-principal-type ServicePrincipal \
    --role "Storage Blob Data Contributor" \
    --scope "${SCOPE_CONT}/dashql-app"

az role assignment create \
    --assignee-object-id "${APP_CI_OID}" \
    --assignee-principal-type ServicePrincipal \
    --role "Storage Blob Data Contributor" \
    --scope "${SCOPE_CONT}/dashql-app-nightly"
