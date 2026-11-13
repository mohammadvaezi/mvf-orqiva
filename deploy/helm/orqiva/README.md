<!-- [PCODE-222 | S15 | v0.1.0] T20.4 Marketplace listings prepared: single-file orq, release assembly, VS Code, container image and Helm listings -->

# Orqiva Helm chart

Orqiva is a self-hosted engineering command center: plans, sprints, AI agents with approvals, tests,
security findings, compliance evidence and releases in one place. This chart runs the Orqiva server on
Kubernetes, with several server nodes sharing one PostgreSQL database.

## Requirements

- A Kubernetes cluster and Helm 3.
- PostgreSQL outside the chart (a managed database or your own operator). Orqiva is tested with
  PostgreSQL 17.
- A ReadWriteMany storage class for the uploads volume when more than one replica runs (NFS, CephFS, EFS,
  Azure Files and similar).

## Install

```sh
kubectl create secret generic orqiva \
  --from-literal=DATABASE_URL='postgres://orqiva:…@db.internal:5432/orqiva' \
  --from-literal=ORQIVA_SECRET_KEY="$(openssl rand -hex 32)"

helm install orqiva ./orqiva \
  --set publicUrl=https://orqiva.example.com \
  --set secrets.existingSecret=orqiva \
  --set ingress.enabled=true --set ingress.host=orqiva.example.com --set ingress.tlsSecret=orqiva-tls
```

Keep `ORQIVA_SECRET_KEY` safe, and never change it: it seals the stored provider keys and secrets.

## Values

| Value                    | Default              | Meaning                                                                                 |
| ------------------------ | -------------------- | --------------------------------------------------------------------------------------- |
| `replicaCount`           | 2                    | Server nodes. With two or more, upgrades have no downtime.                              |
| `publicUrl`              |                      | Where people reach Orqiva. Sign-in, cookies and links are built from it.                |
| `secrets.existingSecret` |                      | A Secret with `DATABASE_URL` and `ORQIVA_SECRET_KEY`.                                   |
| `env`                    | `{}`                 | More settings, e.g. `ORQIVA_OIDC_ISSUER` or `ORQIVA_LICENCE`.                           |
| `ingress.*`              | off                  | An Ingress with long timeouts for the live WebSocket.                                   |
| `persistence.*`          | 20 Gi, ReadWriteMany | The uploads volume.                                                                     |
| `image.*`                | the release's image  | For an air-gapped cluster, push the image from the offline bundle to your own registry. |

## Security

- The pods run as a non-root user on a read-only root file system; only `/data` and `/tmp` are writable.
- Readiness and liveness checks use `/health`.
- Upgrades replace one pod at a time, and a PodDisruptionBudget keeps one pod running.

## Licence

Orqiva is free for up to 5 people. A licence key for more seats is installed in the web app (Settings →
Licence), or with `env.ORQIVA_LICENCE` for the whole install.
