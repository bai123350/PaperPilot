# Alibaba Cloud Production Mapping

Use one region in mainland China for the initial deployment:

| Local service | Alibaba Cloud service |
| --- | --- |
| `web`, `api`, `worker`, `beat` containers | ECS with Docker Compose initially; ACK only after measured scaling pressure |
| PostgreSQL + pgvector | ApsaraDB RDS PostgreSQL with the vector extension enabled |
| Redis | ApsaraDB for Redis with private-network access |
| Local upload volume | OSS private bucket with KMS key and lifecycle rules |
| Container images | Alibaba Cloud Container Registry |
| Secrets | KMS/Secrets Manager; inject at container start |

Set `PAPERPILOT_STORAGE_BACKEND=oss`, configure all `PAPERPILOT_OSS_*` variables, disable demo mode and automatic schema creation, and run `alembic upgrade head` as a release step. Restrict RDS, Redis, and OSS to the VPC. Expose only the web CDN/WAF endpoint and the API HTTPS endpoint. Replace demo authentication before public access.
