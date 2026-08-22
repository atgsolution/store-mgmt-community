#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="$project_dir/.env"
env_template="$project_dir/.env.example"

for command_name in docker openssl sed; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command / Thiếu lệnh bắt buộc: $command_name" >&2
    exit 1
  fi
done

if [[ -e "$env_file" ]]; then
  echo ".env already exists; setup stopped without changing it. / File .env đã tồn tại; setup dừng và không thay đổi file." >&2
  exit 1
fi

read_password() {
  local label="$1"
  local confirmation_label="$2"
  local first=''
  local second=''

  while true; do
    read -r -s -p "$label: " first
    echo
    read -r -s -p "$confirmation_label: " second
    echo

    if [[ "$first" != "$second" ]]; then
      echo "Passwords do not match. / Mật khẩu xác nhận không khớp."
      continue
    fi
    if (( ${#first} < 8 || ${#first} > 128 )); then
      echo "Use 8 to 128 characters. / Mật khẩu phải có từ 8 đến 128 ký tự."
      continue
    fi
    if [[ "$first" =~ [[:space:]] ]] || [[ ! "$first" =~ [A-Za-z] ]] || [[ ! "$first" =~ [0-9] ]] || [[ ! "$first" =~ [^A-Za-z0-9] ]]; then
      echo "Use letters, numbers, and symbols without spaces. / Dùng chữ cái, chữ số và ký tự đặc biệt, không có khoảng trắng."
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

echo "Store MGMT first-time setup / Cài đặt Store MGMT lần đầu"
echo "Password input is hidden; no characters or * will appear."
echo "Khi nhập mật khẩu, terminal sẽ không hiện ký tự hoặc dấu *."
read_password "Admin password / Mật khẩu Admin" "Confirm Admin password / Nhập lại mật khẩu Admin"
admin_password="$REPLY"
read_password "Staff password / Mật khẩu Staff" "Confirm Staff password / Nhập lại mật khẩu Staff"
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
echo "Đã tạo .env với mật khẩu database riêng và hash scrypt cho tài khoản."
echo "Review store information in .env, then run / Kiểm tra thông tin cửa hàng trong .env, sau đó chạy:"
echo "  docker compose config --quiet"
echo "  docker compose up -d --build"
