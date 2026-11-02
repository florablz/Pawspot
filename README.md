# PawSpot 🐾

PawSpot est une application web (mobile d'abord) qui aide les propriétaires de chiens à trouver, sur une carte, les lieux où leur compagnon est le bienvenu : parcs, parcs à chiens, plages, restaurants / bars / cafés avec terrasse, vétérinaires…

Les lieux viennent d'**OpenStreetMap** (API Overpass). La communauté peut ajouter des favoris, des avis, des photos et des alertes (lieu fermé, changement de règle…).

**Stack** : [Nuxt 4](https://nuxt.com) (Vue 3, TypeScript, SSR) · Tailwind CSS · Leaflet · SQLite / libSQL + Drizzle ORM.

---

## Prérequis

- **Node.js ≥ 20** (une version LTS est recommandée). Vérifie avec `node -v`.
- **npm** (installé avec Node).
- Git.

## Installation pas à pas

1. **Récupérer le projet**
   ```bash
   git clone https://github.com/florablz/Pawspot.git
   cd Pawspot
   ```

2. **Installer les dépendances**
   ```bash
   npm install
   ```
   > Avec npm 11, les scripts d'installation des paquets doivent être approuvés : la liste des paquets autorisés est dans le bloc `allowScripts` de `package.json`. Si npm affiche un avertissement `install-scripts`, lance `npm install-scripts ls` pour voir de quoi il s'agit.

3. **Créer le fichier `.env`**
   ```bash
   cp .env.example .env
   ```
   Les valeurs par défaut suffisent pour travailler en local (base SQLite dans le fichier `pawspot.db`). Voir [Variables d'environnement](#variables-denvironnement).

4. **Créer la base de données puis la remplir avec des données de démo**
   ```bash
   npm run db:migrate
   npm run db:seed
   ```

5. **Lancer le serveur de développement**
   ```bash
   npm run dev
   ```
   Ouvre ensuite <http://localhost:3000>.

## Comptes de démo

`npm run db:seed` (après `npm run db:migrate`) crée ces comptes de test, avec quelques avis, favoris et alertes sur des lieux fictifs à Paris (identifiants `demo-*`). Le script est relançable sans créer de doublons.

| Email | Pseudo | Mot de passe | Rôle |
| --- | --- | --- | --- |
| `alice@demo.pawspot.fr` | `alice_demo` | `demo1234` | utilisateur |
| `bruno@demo.pawspot.fr` | `bruno_demo` | `demo1234` | utilisateur |
| `chloe@demo.pawspot.fr` | `chloe_demo` | `demo1234` | utilisateur |

Mots de passe de démonstration uniquement : ne jamais lancer le seed sur la base de production.

## Scripts npm

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement avec rechargement à chaud (<http://localhost:3000>). |
| `npm run build` | Construit l'application pour la production (dossier `.output/`). |
| `npm run preview` | Lance localement la version construite par `build`. |
| `npm run generate` | Génère une version statique (peu utile ici : l'app a besoin de son API). |
| `npm run lint` | Vérifie le code avec ESLint (`@nuxt/eslint`). |
| `npm run lint:fix` | Corrige automatiquement ce qu'ESLint sait corriger. |
| `npm run typecheck` | Vérifie les types TypeScript en mode strict : l'application (`nuxi typecheck`) puis les tests (`vue-tsc` sur `tests/unit/server` et `tests/unit/app`). |
| `npm test` | Lance les tests unitaires (Vitest, sans réseau). Échoue si aucun test n'est trouvé. |
| `npm run db:generate` | Génère une nouvelle migration Drizzle après une modification de `server/database/schema.ts`. |
| `npm run db:migrate` | Applique les migrations à la base désignée par `DATABASE_URL`. |
| `npm run db:seed` | Remplit la base avec des données de démo. |

Avant de proposer une modification : `npm run lint && npm run typecheck && npm test` doivent passer. La même vérification tourne automatiquement sur GitHub (voir `.github/workflows/ci.yml`) à chaque push et pull request vers `main`.

## Variables d'environnement

Toutes les variables sont documentées dans [`.env.example`](.env.example). Le fichier `.env` n'est **jamais** committé.

| Variable | Obligatoire | Description |
|---|---|---|
| `DATABASE_URL` | oui | Adresse de la base. En local : `file:pawspot.db`. En production : URL Turso (`libsql://…`). |
| `DATABASE_AUTH_TOKEN` | en prod | Jeton Turso. Vide en local. |
| `APP_URL` | oui | URL publique de l'app (`http://localhost:3000` en local). |
| `TILE_URL` | non | Modèle d'URL des tuiles de carte. Tuiles OSM par défaut ; un fournisseur gratuit (OpenFreeMap, MapTiler, Stadia…) en production. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` | phase 4 | Stockage des photos sur Cloudflare R2. |
| `RESEND_API_KEY` | phase 4 | Envoi d'emails via Resend. |

## Structure du dépôt

```
app/                Front Nuxt (pages, composants, composables, styles)
  components/       Composants Vue (carte, fiche lieu, avis…)
  composables/      Logique réutilisable (auth, favoris, recherche, géolocalisation)
  pages/            Pages (routes) de l'application
server/             Back Nitro
  api/              Routes d'API (/api/…)
  database/         Schéma Drizzle, connexion et migrations
  utils/            Utilitaires serveur (auth…)
shared/             Types et schémas (Zod) partagés entre front et back (à venir)
scripts/            Scripts de maintenance (migrations, données de démo)
tests/              Tests Vitest
  unit/server/      Tests du back (routes d'API, utilitaires)
  unit/app/         Tests du front (composables, utilitaires)
  fixtures/         Données figées (réponses Overpass…) utilisées par les tests
public/             Fichiers statiques (logo, favicon…)
```

## Mise en ligne

La mise en ligne gratuite (Vercel + Turso + Cloudflare R2 + Resend) est prévue en phase 4 : un guide pas à pas sera ajouté ici à ce moment-là.

## Sources et licences

Les données des lieux proviennent d'[OpenStreetMap](https://www.openstreetmap.org/copyright) (© contributeurs OpenStreetMap, licence ODbL).
