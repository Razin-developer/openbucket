#!/usr/bin/env sh
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 3 ]; then
  echo "Usage: management.sh <file> [bucket] [key]" >&2
  exit 2
fi

: "${OPENBUCKET_ADMIN_TOKEN:?Set OPENBUCKET_ADMIN_TOKEN to the daemon management token.}"

api=${OPENBUCKET_API:-http://127.0.0.1:7272}
api=${api%/}
file=$1
bucket=${2:-openbucket-curl-demo}
key=${3:-$(basename "$file")}
output=${OPENBUCKET_DOWNLOAD_PATH:-./openbucket-curl-download-$(basename "$file")}

if [ ! -f "$file" ]; then
  echo "File not found: $file" >&2
  exit 2
fi

encode_segment() {
  node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$1"
}

encode_key() {
  node -e "process.stdout.write(process.argv[1].split('/').map(encodeURIComponent).join('/'))" "$1"
}

bucket_path=$(encode_segment "$bucket")
key_path=$(encode_key "$key")
authorization="Authorization: Bearer $OPENBUCKET_ADMIN_TOKEN"

bucket_json=$(curl -fsS "$api/v1/buckets" -H "$authorization")
if ! printf '%s' "$bucket_json" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const n=process.argv[1];process.exit(JSON.parse(s).buckets.some(b=>b.name===n)?0:1)})" "$bucket"; then
  create_body=$(node -e "process.stdout.write(JSON.stringify({name:process.argv[1],public:false}))" "$bucket")
  curl -fsS -X POST "$api/v1/buckets" \
    -H "$authorization" \
    -H 'Content-Type: application/json' \
    --data "$create_body"
  printf '\n'
fi

curl -fsS -X PUT "$api/v1/buckets/$bucket_path/objects/$key_path" \
  -H "$authorization" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary "@$file"
printf '\n'

curl -fsS "$api/v1/buckets/$bucket_path/objects" -H "$authorization"
printf '\n'

curl -fsS "$api/v1/buckets/$bucket_path/objects/$key_path" \
  -H "$authorization" \
  -o "$output"

share_body=$(node -e "process.stdout.write(JSON.stringify({key:process.argv[1],expiresIn:300}))" "$key")
curl -fsS -X POST "$api/v1/buckets/$bucket_path/share" \
  -H "$authorization" \
  -H 'Content-Type: application/json' \
  --data "$share_body"
printf '\n'

curl -fsS "$api/v1/analytics" -H "$authorization"
printf '\nDownloaded object to %s\n' "$output"
printf 'The bucket and object were intentionally left in place.\n'
