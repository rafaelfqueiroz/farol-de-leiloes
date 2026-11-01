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

# Field separator of the plan records below. A control character cannot occur in a ref name or a
# path from `git diff --name-only`, and, unlike a tab, a non-whitespace IFS keeps empty fields.
PLAN_SEP=$(printf '\037')

# True (0) when $1 is an all-zero object name, which git uses for "no such ref" in the pre-push input.
is_zero_sha() {
  case "$1" in
    '' | *[!0]*) return 1 ;;
  esac
  return 0
}

# Prints the commit one pushed ref is measured against, and why, as "<rev>|<description>":
#   - the remote's current revision, when the push updates a remote ref we already have locally;
#   - otherwise (a new remote branch, or a force-push over a revision we do not have) the
#     merge-base of the pushed revision with origin/main.
# Prints nothing and returns 1 when neither exists, so the caller can select both packages.
# Arguments: <local_sha> <remote_sha>
resolve_ref_base() {
  _local_sha=$1
  _remote_sha=$2
  if is_zero_sha "$_remote_sha"; then
    _why="new remote branch"
  elif git cat-file -e "$_remote_sha^{commit}" 2>/dev/null; then
    printf '%s|remote revision %s\n' "$_remote_sha" "$(printf '%s' "$_remote_sha" | cut -c1-7)"
    return 0
  else
    _why="remote revision $(printf '%s' "$_remote_sha" | cut -c1-7) is not available locally"
  fi
  if git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
    _merge_base=$(git merge-base "$_local_sha" origin/main 2>/dev/null) || _merge_base=""
    if [ -n "$_merge_base" ]; then
      printf '%s|merge-base with origin/main (%s), %s\n' "$_merge_base" \
        "$(printf '%s' "$_merge_base" | cut -c1-7)" "$_why"
      return 0
    fi
  fi
  return 1
}

# Plans the checks for ONE line of the pre-push input and prints records, one per line, fields
# separated by $PLAN_SEP (free text last):
#   skip <ref> <why>                                   the line deletes a remote ref
#   ref  <ref> <sha> <how the push is measured>        header for a pushed ref
#   none <ref> <sha>                                   no package changed for this ref
#   pkg  <ref> <sha> <package> <place> <why> <reason>  one package to check; <place> is
#                                                      "in-place" or "worktree"
# A package is checked "in-place" only when the pushed revision is the checked-out HEAD and the
# package has no staged, unstaged or untracked changes, so the working tree really is the pushed
# revision for it; anything else needs a temporary worktree at the pushed revision.
# Reads git state of the current directory; run it from the repository root.
# Arguments: <local_ref> <local_sha> <remote_ref> <remote_sha>
plan_push_line() {
  _ref=$1
  _sha=$2
  _remote_sha=$4
  if is_zero_sha "$_sha"; then
    printf 'skip%s%s%sdeleting a remote ref\n' "$PLAN_SEP" "$_ref" "$PLAN_SEP"
    return 0
  fi
  if _info=$(resolve_ref_base "$_sha" "$_remote_sha"); then
    _base=${_info%%|*}
    _how="measured against ${_info#*|}"
    if ! _changed=$(git diff --name-only "$_base...$_sha" 2>/dev/null); then
      _how="could not diff against $_base, selecting both packages"
      _changed=$(printf '%s\n' backend/ frontend/)
    fi
  else
    _how="no remote revision known locally and no origin/main to compare with, selecting both packages"
    _changed=$(printf '%s\n' backend/ frontend/)
  fi
  printf 'ref%s%s%s%s%s%s\n' "$PLAN_SEP" "$_ref" "$PLAN_SEP" "$_sha" "$PLAN_SEP" "$_how"

  _selected=$(printf '%s\n' "$_changed" | select_packages)
  if [ -z "$_selected" ]; then
    printf 'none%s%s%s%s\n' "$PLAN_SEP" "$_ref" "$PLAN_SEP" "$_sha"
    return 0
  fi
  _head=$(git rev-parse HEAD 2>/dev/null) || _head=""
  for _package in backend frontend; do
    _reason=$(printf '%s\n' "$_selected" | sed -n "s/^$_package //p")
    [ -n "$_reason" ] || continue
    if [ "$_sha" != "$_head" ]; then
      _place=worktree
      _place_why="the pushed revision is not the checked-out HEAD"
    elif [ -n "$(git status --porcelain -- "$_package" 2>/dev/null)" ]; then
      _place=worktree
      _place_why="$_package has uncommitted changes, so the checkout is not the pushed revision"
    else
      _place=in-place
      _place_why="the pushed revision is the clean checkout"
    fi
    printf 'pkg%s%s%s%s%s%s%s%s%s%s%s%s\n' "$PLAN_SEP" "$_ref" "$PLAN_SEP" "$_sha" "$PLAN_SEP" \
      "$_package" "$PLAN_SEP" "$_place" "$PLAN_SEP" "$_place_why" "$PLAN_SEP" "$_reason"
  done
}
