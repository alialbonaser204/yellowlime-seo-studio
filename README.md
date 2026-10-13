# Yellowlime SEO Studio

Werkruimte voor SEO-content: partnerprofielen, briefings, SEO-onderzoek via Semrush, artikelgeneratie met Claude en menselijke beoordeling.

## Opbouw

```
apps/
  api/     Express-API (Node.js). Serveert in productie ook de website.
  web/     React-frontend (Vite + Tailwind).
lib/
  api-spec/          OpenAPI-specificatie (bron van de API-types)
  api-zod/           Gegenereerde Zod-validatie voor de API
  api-client-react/  Gegenereerde React Query-hooks voor de frontend
  db/                Databaseschema (Drizzle ORM, PostgreSQL)
```

Eén server draait alles: de API staat op `/api`, de website op alle andere paden.

## Benodigdheden

- Node.js 22.12 of nieuwer
- pnpm (`corepack enable` activeert de juiste versie)
- PostgreSQL 14 of nieuwer
- Een Claude API-sleutel en een Semrush API-sleutel

## Lokaal starten

```bash
corepack enable
pnpm install
cp .env.example .env      # vul DATABASE_URL en de API-sleutels in
pnpm db:push              # maakt/actualiseert de databasetabellen
pnpm dev                  # API op :8080, website op http://localhost:5173
```

Handige commando's:

| Commando | Wat het doet |
|---|---|
| `pnpm dev` | API en website in ontwikkelmodus |
| `pnpm build` | Typecheck en productie-build van alles |
| `pnpm start` | Start de gebouwde app (API + website) op `PORT` |
| `pnpm test` | Unit-tests (geen database nodig) |
| `pnpm --filter @yellowlime/api test:db` | Tests die een database gebruiken |
| `pnpm db:push` | Databaseschema bijwerken na wijzigingen in `lib/db` |
| `pnpm codegen` | API-types opnieuw genereren na wijzigingen in `openapi.yaml` |

## Instellingen (omgevingsvariabelen)

| Variabele | Verplicht | Uitleg |
|---|---|---|
| `DATABASE_URL` | ja | PostgreSQL-verbinding. Bij gehoste databases vaak met `?sslmode=require`. |
| `ANTHROPIC_API_KEY` | ja | Voor partnerprofielen en artikelen (model `claude-sonnet-5`). |
| `SEMRUSH_API_KEY` | ja | Semrush → *Subscription info* → *API units*. |
| `SEMRUSH_MODE` | nee | `mcp` (standaard) of `api`. Zie hieronder. |
| `PORT` | nee | Poort van de server, standaard `8080`. |
| `SEMRUSH_MCP_URL` | nee | Standaard `https://mcp.semrush.com/v2/mcp`. |
| `CORS_ORIGIN` | nee | Alleen nodig als de website op een ander domein staat dan de API. |
| `LOG_LEVEL` | nee | Bijv. `info` of `debug`. |

### Semrush: MCP of klassieke API

- **`SEMRUSH_MODE=mcp`** (standaard): de app haalt de data op via de officiële Semrush MCP-server met je API-sleutel. Dit werkt met Semrush One Starter / Pro+ en SEO Classic Pro / Guru; die bevatten 50.000 API-units per maand.
- **`SEMRUSH_MODE=api`**: de klassieke Semrush API. Daarvoor heb je het Business-pakket met een API-unitpakket nodig.

Beide routes leveren dezelfde gegevens en verbruiken units. Eén volledig SEO-onderzoek (zoekwoordoverzicht, 10 verwante zoekwoorden, 5 vragen en 5 concurrenten) kost ongeveer 1.000 units.

## Hosten

De app is één Node.js-dienst plus een PostgreSQL-database. De meegeleverde `Dockerfile` werkt op elke host die Docker ondersteunt.

### Railway (aanbevolen, eenvoudig)

1. Zet de code in een **nieuwe** GitHub-repository.
2. Maak op [railway.com](https://railway.com) een project → *Deploy from GitHub repo*. Railway gebruikt automatisch de `Dockerfile`.
3. Voeg in hetzelfde project een **PostgreSQL**-database toe.
4. Zet bij de app-dienst onder *Variables*: `DATABASE_URL` (verwijzing naar de Railway-database), `ANTHROPIC_API_KEY` en `SEMRUSH_API_KEY`.
5. Zet onder *Settings → Deploy* de **Pre-deploy command** op `pnpm db:push`.
6. Onder *Settings → Networking* krijg je een tijdelijk adres om te testen.

### Render

1. *New → Web Service* → koppel je GitHub-repository, kies *Docker*.
2. Maak een *PostgreSQL*-database aan en zet de *Internal Database URL* als `DATABASE_URL`.
3. Voeg `ANTHROPIC_API_KEY` en `SEMRUSH_API_KEY` toe.
4. Health check path: `/api/healthz`. Pre-deploy command (betaalde pakketten): `pnpm db:push`. Anders voer je `pnpm db:push` één keer uit vanaf je eigen computer met de *External Database URL* in je `.env`.

### Eigen server (VPS)

```bash
docker build -t yellowlime-studio .
docker run -d --name yellowlime -p 8080:8080 --env-file .env --restart unless-stopped yellowlime-studio
docker run --rm --env-file .env yellowlime-studio pnpm db:push   # schema bijwerken
```

Zet er een reverse proxy met HTTPS voor (bijv. Caddy of Nginx).

### Eigen domein koppelen

1. Test eerst alles op het tijdelijke adres van je host.
2. Voeg bij je host je domein toe (bijv. `studio.jouwdomein.nl`). De host toont welke DNS-records nodig zijn (meestal een `CNAME`).
3. Zet die records bij je domeinregistrar. Na het doorvoeren regelt de host automatisch HTTPS.
4. Werkt alles op het nieuwe domein, dan pas de oude omgeving uitzetten.

## Database

Het schema staat in `lib/db/src/schema`. Na een wijziging: `pnpm db:push`.
Geüploade profielfoto's (max. 2 MB, JPEG/PNG/WebP) worden in de tabel `uploads` bewaard, dus er is geen aparte bestandsopslag nodig.
