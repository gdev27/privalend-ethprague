#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
if [[ -f "$SERVER_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SERVER_DIR/.env"
  set +a
fi

RAILWAY="${RAILWAY:-http://localhost:3000}"
ADMIN_KEY="${ADMIN_KEY:-local-admin}"
TOKEN="${TOKEN:-0x0000000000000000000000000000000000000001}"
WETH="${WETH:-0x000000000000000000000000000000000000beef}"

curl -sS -X POST "$RAILWAY/api/v1/lend-intent" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"0x000000000000000000000000000000000000aaa1\",\"token\":\"$TOKEN\",\"amount\":\"100\",\"encryptedRate\":\"0.04\"}"
echo

curl -sS -X POST "$RAILWAY/api/v1/lend-intent" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"0x000000000000000000000000000000000000aaa2\",\"token\":\"$TOKEN\",\"amount\":\"100\",\"encryptedRate\":\"0.05\"}"
echo

curl -sS -X POST "$RAILWAY/api/v1/lend-intent" \
  -H "content-type: application/json" \
  -d "{\"userId\":\"0x000000000000000000000000000000000000aaa3\",\"token\":\"$TOKEN\",\"amount\":\"100\",\"encryptedRate\":\"0.08\"}"
echo

curl -sS -X POST "$RAILWAY/api/v1/borrow-intent" \
  -H "content-type: application/json" \
  -d "{\"borrower\":\"0x000000000000000000000000000000000000bbb1\",\"token\":\"$TOKEN\",\"amount\":\"150\",\"encryptedMaxRate\":\"0.10\",\"collateralToken\":\"$WETH\",\"collateralAmount\":\"150\"}"
echo

curl -sS -X POST "$RAILWAY/api/v1/borrow-intent" \
  -H "content-type: application/json" \
  -d "{\"borrower\":\"0x000000000000000000000000000000000000bbb2\",\"token\":\"$TOKEN\",\"amount\":\"50\",\"encryptedMaxRate\":\"0.07\",\"collateralToken\":\"$WETH\",\"collateralAmount\":\"50\"}"
echo

curl -sS -X POST "$RAILWAY/admin/tick" -H "x-admin-key: $ADMIN_KEY"
echo

curl -sS "$RAILWAY/api/v1/proposals"
echo
