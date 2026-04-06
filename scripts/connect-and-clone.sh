#!/usr/bin/env bash
set -euo pipefail

# Gera comando de git clone e passos para conectar projeto local ao GitHub.
# Exemplo:
#   ./scripts/connect-and-clone.sh --repo jobarros89/Devops --https

mode="https"
repo=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      repo="${2:-}"
      shift 2
      ;;
    --ssh)
      mode="ssh"
      shift
      ;;
    --https)
      mode="https"
      shift
      ;;
    -h|--help)
      echo "Uso: $0 --repo usuario/repositorio [--https|--ssh]"
      exit 0
      ;;
    *)
      echo "Argumento inválido: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$repo" ]]; then
  echo "Erro: informe --repo usuario/repositorio" >&2
  exit 1
fi

if [[ "$repo" =~ ^https://github.com/([^/]+)/([^/.]+)(\.git)?$ ]]; then
  repo="${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
fi

if [[ ! "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "Formato inválido: $repo" >&2
  exit 1
fi

if [[ "$mode" == "ssh" ]]; then
  url="git@github.com:${repo}.git"
else
  url="https://github.com/${repo}.git"
fi

echo "Comando de clone:"
echo "git clone ${url}"
echo
echo "Para conectar projeto local existente:"
echo "git remote add origin ${url}"
echo "git branch -M main"
echo "git push -u origin main"
