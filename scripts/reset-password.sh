#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if ! command -v docker >/dev/null 2>&1; then
  echo "Missing required command / Thiếu lệnh bắt buộc: docker" >&2
  exit 1
fi

username="${1:-}"
if [[ "$username" != "admin" && "$username" != "staff" ]]; then
  echo "Usage / Cách dùng: bash scripts/reset-password.sh admin|staff" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo ".env was not found. Run scripts/setup-linux.sh first. / Không tìm thấy .env. Hãy chạy scripts/setup-linux.sh trước." >&2
  exit 1
fi

if ! docker compose exec -T api true </dev/null >/dev/null 2>&1; then
  echo "The API container is not running. Start the application first. / API chưa chạy. Hãy khởi động ứng dụng trước." >&2
  exit 1
fi

read_password() {
  local first=''
  local second=''

  while true; do
    read -r -s -p "New password for $username / Mật khẩu mới cho $username: " first
    echo
    read -r -s -p "Confirm password / Nhập lại mật khẩu: " second
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

echo "Password input is hidden; no characters or * will appear."
echo "Khi nhập mật khẩu, terminal sẽ không hiện ký tự hoặc dấu *."
read_password
password="$REPLY"
trap 'unset password REPLY' EXIT

printf '%s' "$password" \
  | docker compose exec -T -e RESET_USERNAME="$username" api node server/reset-password.mjs

unset password REPLY
trap - EXIT
echo "Done. No business data was changed. / Hoàn tất. Dữ liệu kinh doanh không bị thay đổi."
