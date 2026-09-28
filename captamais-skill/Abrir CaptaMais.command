#!/bin/bash
# Abre o CaptaMais no Mac (e Linux) com um duplo clique — sem precisar do Claude, do Cursor ou de terminal.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo " O CaptaMais precisa do Node.js, que ainda não está instalado neste computador."
  echo " Baixe a versão LTS em https://nodejs.org , instale e abra este arquivo de novo."
  echo
  read -n 1 -s -r -p " Pressione qualquer tecla para fechar..."
  exit 1
fi

if [ ! -d node_modules/better-sqlite3 ]; then
  echo
  echo " Primeira vez: preparando o CaptaMais. Isso leva cerca de um minuto..."
  echo
  if ! npm install --no-audit --no-fund; then
    echo
    echo " Não foi possível preparar o CaptaMais. Confira a internet e abra este arquivo de novo."
    read -n 1 -s -r -p " Pressione qualquer tecla para fechar..."
    exit 1
  fi
fi

if ! node scripts/server.mjs; then
  echo
  echo " O CaptaMais não conseguiu iniciar. Veja a mensagem acima."
  read -n 1 -s -r -p " Pressione qualquer tecla para fechar..."
  exit 1
fi
