#!/usr/bin/env bash
# One-time GCP setup, run inside the bootstrap workflow after the owner signs in with gcloud.
# Creates a keyless GitHub -> Google Cloud deploy identity (Workload Identity Federation),
# tightens the web API key and auth domains, and seeds the slide list if it is missing.
set -euo pipefail
P=pathology-draw
REPO=chendoc100-creator/pathology-draw
OUT=${OUT:-ci-out}; mkdir -p "$OUT"; R="$OUT/setup.txt"; : > "$R"
log(){ echo "$*" | tee -a "$R"; }
gcloud config set project "$P" -q >/dev/null 2>&1
TOK=$(gcloud auth print-access-token); echo "::add-mask::$TOK"
api(){ curl -sS -H "Authorization: Bearer $TOK" -H "x-goog-user-project: $P" -H "Content-Type: application/json" "$@"; }

log "== enable APIs"
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  cloudresourcemanager.googleapis.com firebasehosting.googleapis.com firebaserules.googleapis.com \
  firestore.googleapis.com apikeys.googleapis.com identitytoolkit.googleapis.com firebase.googleapis.com -q
NUM=$(gcloud projects describe "$P" --format='value(projectNumber)')
SA="github-deployer@$P.iam.gserviceaccount.com"

log "== deploy service account (no keys are created)"
gcloud iam service-accounts describe "$SA" >/dev/null 2>&1 || gcloud iam service-accounts create github-deployer --display-name="GitHub deploy (keyless)" -q
for r in roles/firebasehosting.admin roles/firebaserules.admin roles/datastore.user roles/serviceusage.serviceUsageConsumer roles/firebase.viewer; do
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:$SA" --role="$r" --condition=None -q >/dev/null; log "granted $r"
done

log "== workload identity pool (only main branch of $REPO may deploy)"
gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub" -q
gcloud iam workload-identity-pools providers describe repo --location=global --workload-identity-pool=github >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc repo --location=global --workload-identity-pool=github \
    --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'" -q
gcloud iam service-accounts add-iam-policy-binding "$SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" -q >/dev/null
PROVIDER="projects/$NUM/locations/global/workloadIdentityPools/github/providers/repo"
printf '{"provider":"%s","sa":"%s"}\n' "$PROVIDER" "$SA" > .github/wif.json
log "provider $PROVIDER"

log "== web API key: allow only the new site"
WEBKEY=$(grep -o 'apiKey:"[^"]*"' src/app.js | head -1 | cut -d'"' -f2)
for name in $(gcloud services api-keys list --format='value(name)'); do
  ks=$(gcloud services api-keys get-key-string "$name" --format='value(keyString)')
  if [ "$ks" = "$WEBKEY" ]; then
    cur=$(api "https://apikeys.googleapis.com/v2/$name")
    log "before: $(jq -c '.restrictions' <<<"$cur")"
    body=$(jq -c '{restrictions:{browserKeyRestrictions:{allowedReferrers:["https://pathology-draw.firebaseapp.com/*","https://pathology-draw.web.app/*"]},apiTargets:(.restrictions.apiTargets // null)}} | if .restrictions.apiTargets==null then del(.restrictions.apiTargets) else . end' <<<"$cur")
    # make sure the APIs the site needs are allowed if the key is limited to specific APIs
    body=$(jq -c 'if .restrictions.apiTargets then .restrictions.apiTargets |= ((. + [{"service":"identitytoolkit.googleapis.com"},{"service":"securetoken.googleapis.com"},{"service":"firestore.googleapis.com"}]) | unique_by(.service)) else . end' <<<"$body")
    mask="restrictions.browserKeyRestrictions"; jq -e '.restrictions.apiTargets' <<<"$body" >/dev/null && mask="$mask,restrictions.apiTargets"
    op=$(api -X PATCH "https://apikeys.googleapis.com/v2/$name?updateMask=$mask" -d "$body")
    sleep 5; log "after:  $(api "https://apikeys.googleapis.com/v2/$name" | jq -c '.restrictions')"
  fi
done

log "== sign-in authorized domains"
cfg=$(api "https://identitytoolkit.googleapis.com/admin/v2/projects/$P/config")
log "before: $(jq -c '.authorizedDomains' <<<"$cfg")"
api -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/$P/config?updateMask=authorizedDomains" \
  -d '{"authorizedDomains":["pathology-draw.firebaseapp.com","pathology-draw.web.app"]}' | jq -c '.authorizedDomains' | sed 's/^/after:  /' | tee -a "$R"

log "== seed slide list if missing"
DOC="https://firestore.googleapis.com/v1/projects/$P/databases/(default)/documents/content/slides"
code=$(api -o /dev/null -w '%{http_code}' "$DOC")
if [ "$code" = 404 ]; then
  node scripts/seed-body.mjs > /tmp/seed.json
  api -X PATCH "$DOC" -d @/tmp/seed.json | jq -r '.name // .error.message' | tee -a "$R"
else log "content/slides already exists (http $code), not touched"; fi
log "== done"
