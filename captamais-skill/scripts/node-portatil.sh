#!/bin/bash
# Baixa o Node.js portátil (oficial, nodejs.org) para <skill>/runtime/node — Mac e Linux.
# Usado por "Abrir CaptaMais.command" quando o computador não tem Node.js 18+.
# Nada é instalado no sistema e o PATH global não é alterado. Uso: node-portatil.sh <pasta-destino>
dest="${1:?informe a pasta de destino}"
base="https://nodejs.org/dist/latest-v22.x"

case "$(uname -s)" in Darwin) os=darwin; ext=tar.gz ;; Linux) os=linux; ext=tar.xz ;; *) exit 1 ;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) exit 1 ;; esac

tmp="$(mktemp -d)" || exit 1
trap 'rm -rf "$tmp"' EXIT

sums="$(curl -fsSL "$base/SHASUMS256.txt")" || exit 1
name="$(printf '%s\n' "$sums" | awk -v re="^node-v[0-9.]+-$os-$arch\\\\.$ext\$" '$2 ~ re {print $2; exit}')"
expected="$(printf '%s\n' "$sums" | awk -v n="$name" '$2 == n {print $1; exit}')"
[ -n "$name" ] && [ -n "$expected" ] || exit 1

curl -fsSL "$base/$name" -o "$tmp/$name" || exit 1
# Só usa o arquivo se o SHA-256 bater com o publicado pelo nodejs.org.
if command -v shasum >/dev/null 2>&1; then actual="$(shasum -a 256 "$tmp/$name" | awk '{print $1}')"; else actual="$(sha256sum "$tmp/$name" | awk '{print $1}')"; fi
[ "$actual" = "$expected" ] || { echo " O arquivo baixado não confere com o checksum oficial."; exit 1; }

tar -xf "$tmp/$name" -C "$tmp" || exit 1
rm -rf "$dest" && mkdir -p "$(dirname "$dest")" || exit 1
mv "$tmp/${name%.$ext}" "$dest" || exit 1
