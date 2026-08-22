#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$project_dir/.env"
env_template="$project_dir/.env.example"

for command_name in docker openssl sed; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

if [[ -e "$env_file" ]]; then
  echo ".env already exists; setup stopped without changing it." >&2
  exit 1
fi

read_password() {
  local label="$1"
  local first=''
  local second=''

  while true; do
    read -r -s -p "$label: " first
    echo
    read -r -s -p "Confirm $label: " second
    echo

    if [[ "$first" != "$second" ]]; then
      echo "Passwords do not match."
      continue
    fi
    if (( ${#first} < 8 )); then
      echo "Use at least 8 characters."
      continue
    fi
    if [[ "$first" =~ [[:space:]] ]] || [[ ! "$first" =~ [[:alpha:]] ]] || [[ ! "$first" =~ [[:digit:]] ]] || [[ ! "$first" =~ [^[:alnum:]] ]]; then
      echo "Use letters, numbers, and symbols without spaces."
      continue
    fi

    REPLY="$first"
    return
  done
}

hash_password() {
  local value="$1"
  printf '%s' "$value" | docker run --rm -i \
    -v "$project_dir:/workspace:ro" \
    -w /workspace \
    node:22-alpine node scripts/hash-password.mjs
}

replace_env() {
  local key="$1"
  local value="$2"
  sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
}

echo "Create the initial Store MGMT accounts. Passwords are not stored as plaintext."
read_password "Admin password"
admin_password="$REPLY"
read_password "Staff password"
staff_password="$REPLY"

admin_hash="$(hash_password "$admin_password")"
staff_hash="$(hash_password "$staff_password")"
unset admin_password staff_password REPLY

cp "$env_template" "$env_file"
chmod 600 "$env_file"

replace_env HOT_DB_PASSWORD "$(openssl rand -hex 32)"
replace_env ARCHIVE_DB_PASSWORD "$(openssl rand -hex 32)"
replace_env STAFF_PASSWORD_HASH "'$staff_hash'"
replace_env ADMIN_PASSWORD_HASH "'$admin_hash'"

unset admin_hash staff_hash

echo "Created .env with unique database secrets and scrypt password hashes."
echo "Review store information in .env, then run:"
echo "  docker compose config --quiet"
echo "  docker compose up -d --build"
