# Package selection for the pre-push hook (DEVELOPMENT DV-37). POSIX sh, meant to be sourced.
# Kept free of side effects so it can be tested with fabricated file lists.

# Reads changed file paths (repository-relative, one per line) on stdin and prints one
# "<package> <reason>" line per package that must be checked:
#   backend/*   -> backend
#   frontend/*  -> frontend
#   shared root files (.node-version, docker-compose.yml, root package.json and lockfile,
#   .husky/, root lint/format config) -> both
#   everything else (docs/, .github/, README, CLAUDE.md, ...) -> nothing
select_packages() {
  backend_reason=""
  frontend_reason=""
  while IFS= read -r file; do
    case "$file" in
      '') ;;
      backend/*)
        [ -n "$backend_reason" ] || backend_reason="$file changed"
        ;;
      frontend/*)
        [ -n "$frontend_reason" ] || frontend_reason="$file changed"
        ;;
      .node-version | docker-compose.yml | docker-compose.*.yml | package.json | package-lock.json | \
        .husky/* | .prettierrc* | .prettierignore | .editorconfig | eslint.config.* | \
        .eslintignore | lint-staged.config.* | .lintstagedrc*)
        [ -n "$backend_reason" ] || backend_reason="shared file $file changed"
        [ -n "$frontend_reason" ] || frontend_reason="shared file $file changed"
        ;;
      *) ;;
    esac
  done
  [ -z "$backend_reason" ] || printf 'backend %s\n' "$backend_reason"
  [ -z "$frontend_reason" ] || printf 'frontend %s\n' "$frontend_reason"
}

# Prints the commit the push is measured against, and why, as "<rev>|<description>":
# the branch's upstream, else its merge-base with origin/main. Prints nothing and returns 1 when
# neither exists, so the caller can fall back to checking everything.
resolve_push_base() {
  upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null) || upstream=""
  if [ -n "$upstream" ]; then
    printf '%s|upstream %s\n' "$upstream" "$upstream"
    return 0
  fi
  if git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
    merge_base=$(git merge-base HEAD origin/main 2>/dev/null) || merge_base=""
    if [ -n "$merge_base" ]; then
      printf '%s|merge-base with origin/main (%s)\n' "$merge_base" "$(printf '%s' "$merge_base" | cut -c1-7)"
      return 0
    fi
  fi
  return 1
}
