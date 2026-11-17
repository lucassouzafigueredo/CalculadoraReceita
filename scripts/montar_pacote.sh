#!/usr/bin/env bash
# Monta o pacote Windows do simulador a partir da ÚLTIMA versão da calculadora oficial.
# Usado pelo GitHub Actions (diariamente) e pode ser rodado localmente em Linux/macOS.
#
# Uso: scripts/montar_pacote.sh <pasta_saida> [ref_calculadora (padrão: main)] [--sem-jre]
# Saída:
#   <saida>/Simulador-RTC-Windows.zip     pacote completo (Java embutido) para o primeiro uso
#   <saida>/atualizacao-simulador-rtc.zip apenas app + scripts (usado pela atualização automática)
#   <saida>/versao.json                    metadados da versão
#   <saida>/notas.md                       novidades da calculadora (topo do CHANGELOG oficial)
set -euo pipefail

SAIDA="$(mkdir -p "${1:?informe a pasta de saída}" && cd "$1" && pwd)"
REF="${2:-main}"
SEM_JRE="${3:-}"
SIM="$(cd "$(dirname "$0")/.." && pwd)"
TRAB="$(mktemp -d)"
REPO_OFICIAL="https://github.com/ReceitaFederal/calculadora-rtc-regime-regular.git"
JRE_URL="https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse"

echo ">> Baixando a calculadora oficial ($REF)"
git clone --depth 1 --branch "$REF" "$REPO_OFICIAL" "$TRAB/calc"
cd "$TRAB/calc"
COMMIT="$(git rev-parse HEAD)"
DATA_COMMIT="$(git log -1 --format=%cI)"

MVN="mvn"
command -v mvn >/dev/null 2>&1 || MVN="./mvnw"

echo ">> Gerando o banco de tabelas oficiais"
mkdir -p calculadora/db
$MVN -q flyway:migrate -Dflyway.configFiles=./flyway/flyway-pro.conf --batch-mode --errors

echo ">> Compilando a calculadora"
$MVN -q clean package -DskipTests --batch-mode
VERSAO_APP="$($MVN -q help:evaluate -Dexpression=project.version -DforceStdout --batch-mode 2>/dev/null | tail -1)"
VERSAO_DB="$(ls flyway/sql | sed -n 's/^\(V[0-9]*\)__.*/\1/p' | sort -V | tail -1)"
HASH_SIM="$(cd "$SIM" && git ls-tree HEAD web pacote scripts 2>/dev/null | sha1sum | cut -c1-7)"
PACOTE="v${VERSAO_APP}-${COMMIT:0:7}-s${HASH_SIM}"

echo ">> Montando app/ (pacote $PACOTE)"
APP="$TRAB/Simulador-RTC/app"
mkdir -p "$APP/calculadora/db"
cp target/api-regime-geral.jar "$APP/"
cp calculadora/db/calculadora-pro.db "$APP/calculadora/db/"
cp LICENSE "$APP/LICENSE-calculadora-oficial.txt"
cp -r "$SIM/web" "$APP/web"
cat > "$APP/web/versao.json" <<EOF
{
  "pacote": "$PACOTE",
  "versao_calculadora": "$VERSAO_APP",
  "versao_tabelas": "$VERSAO_DB",
  "commit_calculadora": "$COMMIT",
  "data_commit_calculadora": "$DATA_COMMIT",
  "montado_em": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
cp "$APP/web/versao.json" "$SAIDA/versao.json"

# notas: primeira seção do CHANGELOG oficial
awk '/^## \[/{n++} n==1' CHANGELOG.md > "$SAIDA/notas.md" || true

echo ">> Teste rápido: subindo a calculadora com a tela do simulador"
PORTA=18765
( cd "$APP" && java -Dspring.profiles.active=offline -jar api-regime-geral.jar --server.port=$PORTA \
    --spring.web.resources.static-locations=file:./web/ --management.server.port=-1 > "$TRAB/api.log" 2>&1 & echo $! > "$TRAB/pid" )
OK=""
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:$PORTA/api/calculadora/dados-abertos/versao" > /dev/null; then OK=1; break; fi
  sleep 2
done
if [ -z "$OK" ]; then cat "$TRAB/api.log"; kill "$(cat "$TRAB/pid")" || true; echo "Calculadora não subiu"; exit 1; fi
curl -sf "http://localhost:$PORTA/api/simulador.html" | grep -q "Simulador" || { echo "Tela não publicada"; exit 1; }
RESP="$(curl -sf -X POST "http://localhost:$PORTA/api/calculadora/observabilidade/regime-geral" -H 'Content-Type: application/json' \
  -d '{"id":"t","versao":"1.0.0","dhFatoGerador":"2027-03-10T10:00:00-03:00","municipio":4314902,"uf":"RS","itens":[{"numero":1,"nbs":"122011200","cst":"200","cClassTrib":"200028","baseCalculo":1200.00,"aliquotasNominais":{"cbs":8.8,"ibsEstadual":0.05,"ibsMunicipal":0.05}}]}')"
echo "$RESP" | grep -q '"vCBS":"42.24"' || { echo "Cálculo de referência divergiu: $RESP"; exit 1; }
if [ -n "${E2E:-}" ]; then node "$SIM/scripts/teste_e2e.js" "http://localhost:$PORTA/api/simulador.html" "$TRAB/e2e"; fi
kill "$(cat "$TRAB/pid")" || true
echo "   referência OK (educação: CBS 42,24)"

echo ">> Copiando lançadores"
cp -r "$SIM/pacote/." "$TRAB/Simulador-RTC/"

echo ">> Gerando zip de atualização"
( cd "$TRAB/Simulador-RTC" && zip -qr "$SAIDA/atualizacao-simulador-rtc.zip" app scripts )

if [ "$SEM_JRE" != "--sem-jre" ]; then
  echo ">> Baixando Java 21 (JRE Temurin para Windows x64)"
  curl -sfL "$JRE_URL" -o "$TRAB/jre.zip"
  unzip -q "$TRAB/jre.zip" -d "$TRAB/jre_tmp"
  mv "$TRAB"/jre_tmp/* "$TRAB/Simulador-RTC/jre"
  ( cd "$TRAB" && zip -qr "$SAIDA/Simulador-RTC-Windows.zip" Simulador-RTC )
fi

echo "PACOTE=$PACOTE" > "$SAIDA/pacote.env"
echo ">> Pronto: $PACOTE"
ls -lh "$SAIDA"
