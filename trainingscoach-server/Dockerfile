# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stap 1 — de interface bouwen.
#
# Dit gebeurde eerder op de Pi, met het resultaat in een volume. Dat werkte,
# maar betekende dat een deploy alleen de server verving: de interface bleef
# staan tot iemand met de hand `npm run build` draaide. Vergeet je dat, dan
# draait er een scherm dat niet bij de server past, en dat zie je pas als een
# knop niet doet wat hij belooft.
#
# De bouwcontext is daarom de hele repo en niet alleen trainingscoach-server:
# deze stap heeft beide mappen nodig.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS interface
WORKDIR /build

# De rekenkern staat aan de serverkant en wordt door het prebuild-script naar
# de frontend gekopieerd, dus die moet er zijn vóór de build begint.
COPY trainingscoach-server/src/lib/calculations.js trainingscoach-server/src/lib/calculations.js

# Eerst alleen de afhankelijkheden: die veranderen zelden, dus deze laag blijft
# in de cache staan terwijl de broncode eronder wel wijzigt.
COPY trainingscoach-frontend/package.json trainingscoach-frontend/package-lock.json trainingscoach-frontend/
WORKDIR /build/trainingscoach-frontend
RUN npm ci

COPY trainingscoach-frontend/ ./
# Vite schrijft naar ../trainingscoach-server/public, dus het resultaat landt
# op /build/trainingscoach-server/public.
RUN npm run build

# ---------------------------------------------------------------------------
# Stap 2 — de server, met de gebouwde interface erin.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim

# better-sqlite3 wordt uit broncode gebouwd en heeft een toolchain nodig.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY trainingscoach-server/package.json trainingscoach-server/package-lock.json ./
RUN npm ci --omit=dev

COPY trainingscoach-server/ ./
COPY --from=interface /build/trainingscoach-server/public ./public

CMD ["node", "src/server.js"]
