#!/usr/bin/env bash
# Downloads the official NCTB 2026 Class 9–10 (Bangla version) science/maths textbooks and runs
# each through the ingestion pipeline (POST /ingestion-jobs/upload). Needs the API, the AI service,
# Redis and Postgres running. Usage:
#   scripts/ingest-nctb.sh [book-key ...]      # default: all five
#   API=http://localhost:4000/api/v1 ADMIN=super@shikkha.ai PASSWORD=demo-password-123 scripts/ingest-nctb.sh physics
# Source page: https://nctb.gov.bd/pages/static-pages/695b99afc4774958d7b70612 (link 2 = egovcloud).
set -euo pipefail
API=${API:-http://localhost:4000/api/v1}
ADMIN=${ADMIN:-super@shikkha.ai}
PASSWORD=${PASSWORD:-demo-password-123}
DIR=${DIR:-./storage/nctb}
mkdir -p "$DIR"

# key | bookId | title | egovcloud share id
BOOKS="physics|book-ssc-physics-bn|পদার্থবিজ্ঞান|KOdI1T0gyhPiFRz
chemistry|book-ssc-chemistry-bn|রসায়ন|sDHVsdQgt7dVQzO
biology|book-ssc-biology-bn|জীববিজ্ঞান|MCyVlYL9pnrc5gy
math|book-ssc-math-bn|সাধারণ গণিত|HwrCrAtDhb9K484
higher-math|book-ssc-higher-math-bn|উচ্চতর গণিত|iSz6xhjfGbQnu4G"

TOKEN=$(curl -s "$API/auth/login" -H 'content-type: application/json' \
  -d "{\"identifier\":\"$ADMIN\",\"password\":\"$PASSWORD\"}" |
  python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print(d.get("session",d)["accessToken"])')

want=" ${*:-physics chemistry biology math higher-math} "
while IFS='|' read -r key id title share; do
  [[ "$want" == *" $key "* ]] || continue
  pdf="$DIR/$key-bn.pdf"
  if [[ ! -s "$pdf" ]]; then
    echo "Downloading $key…"
    curl -sL -o "$pdf" "https://drive.egovcloud.gov.bd/index.php/s/$share/download"
  fi
  file "$pdf" | grep -q PDF || { echo "$key: download is not a PDF" >&2; continue; }
  echo "Uploading $key ($id)…"
  curl -s "$API/ingestion-jobs/upload" -H "Authorization: Bearer $TOKEN" \
    -F "file=@$pdf;type=application/pdf" --form-string "bookId=$id" --form-string "bookTitle=$title" \
    --form-string "publisher=জাতীয় শিক্ষাক্রম ও পাঠ্যপুস্তক বোর্ড (NCTB)" --form-string "edition=২০২৬ শিক্ষাবর্ষ" \
    --form-string "licenseType=publisher_license" --form-string "licenseHolder=জাতীয় শিক্ষাক্রম ও পাঠ্যপুস্তক বোর্ড (NCTB)" \
    --form-string "licenseNote=Official NCTB textbook for the 2026 academic year, distributed free by the Government of Bangladesh (nctb.gov.bd). Copyright NCTB." |
    python3 -c 'import sys,json;d=json.load(sys.stdin);j=d.get("data",d);print("  job:", j.get("id"), j.get("stage"), d.get("message",""))'
done <<< "$BOOKS"
echo "Follow progress in Admin → Books (ingestion pipeline). Approve the review step to publish."
