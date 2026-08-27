# Automatic backup snapshots

Every push to any branch triggers `.github/workflows/backup-snapshot.yml`, which
tags the commit that existed **before** the push. Nothing that was on a branch
becomes unrecoverable, even after a force-push or a history rewrite.

## Tag names

| Tag | Meaning | Retention |
| --- | --- | --- |
| `backup/<branch>/<timestamp>` | Routine push | Newest 30 per branch |
| `backup/<branch>/<timestamp>-rewrite` | History was rewritten | Kept forever |

Timestamps are UTC, `YYYY-MM-DD-HHMMSS`.

## Restoring

```bash
git fetch --tags
git log --oneline <tag>          # inspect first
git checkout <tag>               # look around
git switch -c recovered <tag>    # or branch off it
```

To put a branch back exactly as it was:

```bash
git fetch --tags
git reset --hard <tag>
git push --force-with-lease
```

That force-push is itself snapshotted first, so it is reversible too.

## Notes

- Pruning only ever removes routine snapshots, whose commits remain reachable
  from the branch anyway. Rewrite snapshots are never deleted.
- Branch *deletions* are not covered: GitHub does not run workflows for a ref
  that no longer exists.
- The workflow needs Actions write permission
  (Settings -> Actions -> General -> Workflow permissions -> Read and write).
