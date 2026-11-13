<!-- [PCODE-218 | S15 | v0.1.0] T20.1 Public docs site built from the repository (own Markdown renderer, CLI and API reference, link check) -->

# Offline install and backups

## Installing without internet

Some sites have no internet. Prepare a bundle on a machine that has internet, carry it over, and install
from it. Nothing is downloaded on the closed site.

**1. On a connected machine,** with Docker and a copy of Orqiva:

```
orq bundle --out orqiva-0.1.0.tar
```

This saves three images into one file: the Orqiva server, PostgreSQL 17, and Caddy for HTTPS. It also
writes `orqiva-0.1.0.tar.json`, a manifest that names the images and the file's SHA-256.

**2. Copy both files** to the closed site, together with the `orq` command (Node.js 22 must be installed
there).

**3. On the closed site:**

```
orq install --bundle orqiva-0.1.0.tar --public-url https://orqiva.internal
```

The install first checks the file against its manifest. A file that changed or was damaged on the way is
refused. Then it loads the images and starts Orqiva without pulling anything. Licences are signed keys and
are checked offline.

Upgrades work the same way: make a new bundle, copy it over, and run `orq install --bundle` again.

## Backups

```
orq backup                    # into ~/orqiva/backups, with a date in the name
orq backup --out FILE         # somewhere else
```

A backup is a PostgreSQL dump with the uploaded files beside it. Before it counts, Orqiva reads it back
with `pg_restore --list` and writes `FILE.sha256` next to it. A backup that does not read back is reported
as failed, not kept as if it were fine.

Copy backups off the machine regularly, with their `.sha256` files.

### Checking an older backup

```
orq backup --verify FILE
```

This checks the file against its checksum and confirms that PostgreSQL can read it. Run it on the copies
you keep elsewhere, for example once a month.

## Restore

```
orq restore FILE --yes
```

This replaces all the data of the install with the backup. A backup that does not match its checksum is
refused, and nothing is changed. After a restore the server starts again and runs any migrations the
backup needs.

On Kubernetes, use your cluster's PostgreSQL backups. See [Kubernetes](install-kubernetes.md).
