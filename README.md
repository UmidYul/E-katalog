# E-katalog Platform

- Backend services: `services/`
- Shared modules: `shared/`
- Infra and deployment: `infra/`
- Alembic migrations: `migrations/`
- Ops scripts: `scripts/`
- Frontend app: `frontend/`

## Run Full Stack (Nginx + Frontend + API + Workers)

```bash
cp .env.example .env
docker compose -f infra/docker/docker-compose.yml up --build -d
docker compose -f infra/docker/docker-compose.yml exec api alembic -c /srv/migrations/alembic.ini upgrade head
```

Open:
- `http://localhost` -> Next.js frontend behind Nginx
- `http://localhost/api/v1/health` -> FastAPI health

## Frontend Local

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

See `frontend/README.md` for frontend details.
