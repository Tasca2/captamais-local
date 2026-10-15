#!/bin/bash
# Abre o CaptaMais no Mac (e Linux) com um duplo clique — sem precisar do Claude, do Cursor ou de terminal.
# Se o computador não tiver Node.js 18+, baixa um Node portátil oficial para runtime/node nesta pasta.
# Nada é instalado no sistema e o PATH não é alterado.
# Opção --silencioso: sem pausas nem perguntas (usada quando o Claude instala/abre a skill).
cd "$(dirname "$0")" || exit 1
SILENCIOSO=0; [ "$1" = "--silencioso" ] && SILENCIOSO=1

node_ok() {
  command -v node >/dev/null 2>&1 && node -e 'process.exit(parseInt(process.versions.node,10)>=18?0:1)' >/dev/null 2>&1
}

pausa() { [ "$SILENCIOSO" = 1 ] || read -n 1 -s -r -p " Pressione qualquer tecla para fechar..."; }

[ -x runtime/node/bin/node ] && export PATH="$PWD/runtime/node/bin:$PATH"

if ! node_ok; then
  echo
  echo " Preparando o CaptaMais pela primeira vez. Estou baixando o Node.js, sem precisar instalar nada."
  echo " Isso leva alguns minutos e precisa de internet..."
  echo
  if bash scripts/node-portatil.sh "$PWD/runtime/node"; then
    export PATH="$PWD/runtime/node/bin:$PATH"
  fi
  if ! node_ok; then
    echo
    echo " Não consegui baixar o Node.js automaticamente. Confira a internet e abra este arquivo de novo."
    echo " Se continuar, instale o Node.js LTS em https://nodejs.org"
    echo
    pausa
    exit 1
  fi
fi

if [ ! -d node_modules/better-sqlite3 ]; then
  echo
  echo " Primeira vez: preparando o CaptaMais. Isso leva cerca de um minuto..."
  echo
  if ! npm install --no-audit --no-fund; then
    echo
    echo " Não foi possível preparar o CaptaMais. Confira a internet e abra este arquivo de novo."
    pausa
    exit 1
  fi
fi

if ! node scripts/server.mjs; then
  echo
  echo " O CaptaMais não conseguiu iniciar. Veja a mensagem acima."
  pausa
  exit 1
fi

# Atalho CaptaMais na Área de Trabalho: cria sozinho quando o Claude instala; no duplo clique pergunta uma vez.
if [ "$SILENCIOSO" = 1 ]; then node scripts/atalho.mjs --instalar; else node scripts/atalho.mjs --oferecer; fi
