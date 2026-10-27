#!/usr/bin/env bash
# Wdrożenie na MyDevil (Phusion Passenger): testy lokalne → rsync kodu → npm ci → restart.
# Użycie:  deploy/deploy-mydevil.sh            (domyślnie host "mydevil", domena audytor.feer.org.pl)
#          DEPLOY_HOST=s89 DEPLOY_DOMAIN=audytor.feer.org.pl deploy/deploy-mydevil.sh
# Plik .env, katalog data/ (baza, załączniki) i node_modules nigdy nie są nadpisywane ani usuwane.
set -euo pipefail

HOST="${DEPLOY_HOST:-mydevil}"
DOMAIN="${DEPLOY_DOMAIN:-audytor.feer.org.pl}"
cd "$(dirname "$0")/.."

echo "→ testy lokalne"
npm test --silent

REMOTE_HOME="$(ssh "$HOST" 'echo $HOME')"
APP_DIR="$REMOTE_HOME/domains/$DOMAIN/public_nodejs"

ssh "$HOST" "test -d '$APP_DIR'" || { echo "Brak $APP_DIR na serwerze. Najpierw: devil www add $DOMAIN nodejs /usr/local/bin/node22 production" >&2; exit 1; }
ssh "$HOST" "test -f '$APP_DIR/.env'" || { echo "Brak $APP_DIR/.env na serwerze (wzór: .env.production.example)." >&2; exit 1; }

echo "→ wysyłanie kodu do $HOST:$APP_DIR"
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude '.env' --exclude '/data' --exclude '/public' \
  --exclude '.DS_Store' --exclude '.claude' \
  ./ "$HOST:$APP_DIR/"

echo "→ instalacja zależności i restart"
ssh "$HOST" "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund && devil www restart '$DOMAIN'"

echo "✓ wdrożono: https://$DOMAIN"
