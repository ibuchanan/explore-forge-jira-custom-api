#!/usr/bin/env bash
# Sets Forge variables in the configured Forge environment for .env vars.

set -euo pipefail

# Load FORGE_ENVIRONMENT from .env for the Forge CLI target environment.
# shellcheck disable=SC1091
source ./.env
FORGE_ENVIRONMENT=${FORGE_ENVIRONMENT:-development}

# Match lines that don't start with # (comments) and have a key=value pair
grep '^[^#]\w*=.*' ./.env | while IFS='=' read -r key value; do
  case "$key" in
  FORGE*)
    # Skip Forge CLI configuration and authentication variables.
    :
    ;;
  *TOKEN*)
    # Encrypt vars that contain TOKEN.
    echo forge variables set --environment "$FORGE_ENVIRONMENT" --encrypt "$key" "****"
    forge variables set --environment "$FORGE_ENVIRONMENT" --encrypt "$key" "$value"
    ;;
  *)
    echo forge variables set --environment "$FORGE_ENVIRONMENT" "$key" "$value"
    forge variables set --environment "$FORGE_ENVIRONMENT" "$key" "$value"
    ;;
  esac
done
