# PawSpot — conventions du projet

PawSpot est un « Google Maps pour chiens », pensé d'abord pour le mobile, en français, couvrant toute la France.

- **Spécification :** `CAHIER_DES_CHARGES.md` fait foi. Les décisions de la §10 sont validées par Flora.
- **Organisation des agents :** `AGENTS_PAWSPOT.md`.
- **Méthode :** on travaille phase par phase (§7 du cahier), en respectant les règles de la §8.

## Stack
- **Framework :** Nuxt 4 (Vue 3, TypeScript strict, SSR). Le code client est dans `app/`, l'API Nitro dans `server/`.
- **Style :** Tailwind avec le thème `paw-*` (marron, orange, vert, plus bleu, rouge et blanc), la classe `glass` et le logo patte. Toute nouvelle couleur se définit dans `tailwind.config.ts`.
- **Carte :** Leaflet, côté client uniquement.
- **Lieux :** données OpenStreetMap via Overpass. Chaque appel sortant envoie `PAWSPOT_USER_AGENT` (`server/utils/http.ts`).
- **Base de données :** SQLite via libSQL (`@libsql/client`) et Drizzle.
  - Le client est **asynchrone** : on met `await` partout.
  - Pour récupérer un id après un insert, on utilise `.returning()`, jamais `lastInsertRowid`.
  - La connexion se configure avec `DATABASE_URL` et `DATABASE_AUTH_TOKEN` (voir `.env.example`).
- **Auth :** faite maison, avec bcrypt et des sessions stockées en base (cookie httpOnly `pawspot-session`).

## Commandes
```bash
npm run dev          # serveur de dev
npm run lint         # ESLint (@nuxt/eslint)
npm run typecheck    # nuxi typecheck (+ tests)
npm test             # Vitest (projets server = node, app = happy-dom)
npm run db:generate  # génère une migration après modification de server/database/schema.ts
npm run db:migrate   # applique les migrations (à lancer avant dev)
npm run db:seed      # comptes de démo — local uniquement, jamais sur la prod
```
Node est installé par Homebrew. S'il n'est pas trouvé, faire `export PATH=/opt/homebrew/bin:$PATH`.

## Règles
- Avant de déclarer une tâche terminée, `lint`, `typecheck` et `test` doivent passer.
- Faire de petits commits, un sujet par commit, en français, au format `type(portée): message` (ex. `fix(front): …`).
- Ne jamais committer de base (`*.db*`), d'upload, de `.env` ni de secret. Ne pas pousser, déployer ou créer de compte en ligne sans l'accord de Flora.
- Les tests n'appellent jamais Overpass ni Nominatim en vrai : on utilise des mocks et les fixtures de `tests/fixtures/`.
- Interface en français avec les accents. Zones tactiles d'au moins 44 px. Pas de `v-html` sur du contenu utilisateur.
- Les erreurs d'API ont la forme `{ statusCode, message }`, avec un message en français et sans détail interne.
- Les types et la configuration communs au client et au serveur iront dans `shared/` (à partir de la phase 1). Les types de réponse API provisoires sont dans `app/types/api.ts`.

## Agents (`.claude/agents/`)
Chaque fichier a un seul agent responsable (tableau de la §1 de `AGENTS_PAWSPOT.md`) :
- `front` : `app/`, `public/`, `tailwind.config.ts` ;
- `back` : `server/api`, `server/utils`, `server/middleware` ;
- `donnees` : `server/database`, `server/services/places`, `shared/`, `scripts/db-*` ;
- `tests` : `tests/`, `e2e/`, configurations Vitest et Playwright ;
- `devops` : scripts npm, `nuxt.config.ts`, CI, `.env.example`, README.

`securite` et `ux-a11y` relisent sans rien modifier.
