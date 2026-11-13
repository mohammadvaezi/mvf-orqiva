<!-- [PCODE-214 | S15 | v0.1.0] T19.3 Several server nodes (events, presence and migrations across nodes) and a Helm chart -->

# Orqiva on Kubernetes (several server nodes)

For teams that run their own cluster. A single machine is simpler: see [install-server.md](install-server.md)
(`orq install`, Docker Compose).

## What several nodes share

| Shared         | How                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data           | One PostgreSQL (version 15 or newer), managed or your own. Every node reads and writes it.                                                                                          |
| Live events    | The database's `LISTEN/NOTIFY` (channel `orqiva_events`): a change made through any node reaches screens on every node, within a second.                                            |
| Presence       | The same way (channel `orqiva_presence`): who is where crosses nodes.                                                                                                               |
| Migrations     | The first node to start migrates; the others wait on an advisory lock and find nothing to do.                                                                                       |
| Uploaded files | One volume mounted on every node at `/data`. With more than one replica it must be **ReadWriteMany** (NFS, CephFS, Amazon EFS, Azure Files). The chart refuses another access mode. |

No sticky sessions are needed: any node serves any workspace, and a live screen that reconnects to another
node gets what it missed.

Tested in `packages/server/test/db/multinode.test.ts`: two nodes on one database, events both ways under a
second, presence across nodes, one migration run.

## Install with Helm

```sh
kubectl create secret generic orqiva \
  --from-literal=DATABASE_URL='postgres://orqiva:…@db.internal:5432/orqiva' \
  --from-literal=ORQIVA_SECRET_KEY="$(openssl rand -hex 32)"

helm install orqiva deploy/helm/orqiva \
  --set publicUrl=https://orqiva.example.com \
  --set secrets.existingSecret=orqiva \
  --set ingress.enabled=true --set ingress.host=orqiva.example.com --set ingress.tlsSecret=orqiva-tls \
  --set persistence.storageClass=nfs-client
```

Keep `ORQIVA_SECRET_KEY` safe and never change it: it seals stored provider keys and secrets.

| Value                    | Default                   | Meaning                                                                                                     |
| ------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `replicaCount`           | 2                         | Server nodes. Two or more for no downtime on upgrades (a PodDisruptionBudget keeps one up).                 |
| `publicUrl`              |                           | Where people reach Orqiva. SAML, OIDC, cookies and links are built from it.                                 |
| `secrets.existingSecret` |                           | A Secret with `DATABASE_URL` and `ORQIVA_SECRET_KEY`. Or set `secrets.databaseUrl` and `secrets.secretKey`. |
| `env`                    | `{}`                      | More settings, e.g. `ORQIVA_OIDC_ISSUER`, `ORQIVA_LICENCE`, `ORQIVA_RATE_REQUESTS`.                         |
| `ingress.*`              | off                       | An Ingress with long timeouts for the live WebSocket (`/live`).                                             |
| `persistence.*`          | 20 Gi, ReadWriteMany      | The uploads volume.                                                                                         |
| `image.*`                | `prodengine/server:0.1.0` | For an air-gapped cluster, push the image from the offline bundle to your registry.                         |

The pods run as a non-root user on a read-only root file system; only `/data` and `/tmp` are writable.
Readiness and liveness use `/health`.

## Upgrades

`helm upgrade` replaces the pods one at a time (`maxUnavailable: 0`). The first new pod migrates the
database; old and new pods run side by side for a moment, so a release never removes a column in the same
version that stops using it.
