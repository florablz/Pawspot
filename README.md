# PawSpot 🐾

PawSpot est une application web (mobile d'abord) qui aide les propriétaires de chiens à trouver, sur une carte, les lieux où leur compagnon est le bienvenu : parcs, parcs à chiens, plages, restaurants / bars / cafés avec terrasse, vétérinaires…

Les lieux viennent d'**OpenStreetMap** (API Overpass). La communauté peut ajouter des favoris, des avis, des photos et des alertes (lieu fermé, changement de règle…).

**Stack** : [Nuxt 4](https://nuxt.com) (Vue 3, TypeScript, SSR) · Tailwind CSS · Leaflet · SQLite / libSQL + Drizzle ORM.

---

## Prérequis

- **Node.js ≥ 20** (une version LTS est recommandée). Vérifiez avec `node -v`.
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
   > Avec npm 11, les scripts d'installation des paquets doivent être approuvés : la liste des paquets autorisés est dans le bloc `allowScripts` de `package.json`. Si npm affiche un avertissement `install-scripts`, lancez `npm install-scripts ls` pour voir de quoi il s'agit.

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
   > Bon à savoir : avec une base locale (le fichier `pawspot.db`), les migrations sont **appliquées automatiquement** à chaque démarrage du serveur (`npm run dev`, ou `npm run preview` après un build). Après un `git pull` qui ajoute une migration, il suffit donc de relancer `npm run dev`. La commande `npm run db:migrate` reste disponible : elle est nécessaire ici avant `npm run db:seed` (le seed a besoin des tables), et elle affiche le détail complet en cas d'erreur.

5. **Lancer le serveur de développement**
   ```bash
   npm run dev
   ```
   Ouvrez ensuite <http://localhost:3000>.
   > Sécurité : le serveur de développement n'est **pas** fait pour être exposé. Ne le lancez pas avec `--host` (ni `npm run dev -- --host`) sur un réseau partagé (wifi public, bureau…) : il est alors joignable par les autres machines du réseau, sans aucune protection.

## Si aucun lieu ne s'affiche

Deux causes fréquentes, à vérifier dans cet ordre :

1. **La base n'est pas à jour (pas migrée).** Le terminal où tourne `npm run dev` affiche alors un message `[PawSpot] ÉCHEC des migrations…` ou `Migrations automatiques ignorées…`, et les pages renvoient des erreurs.
   - Arrêtez le serveur (`Ctrl + C`) puis relancez `npm run dev` **depuis la racine du projet** (le dossier `Pawspot`) : les migrations s'appliquent au démarrage.
   - Si le problème persiste, lancez `npm run db:migrate` : la commande affiche l'erreur en détail.

2. **Les serveurs Overpass (OpenStreetMap) sont saturés.** Les lieux viennent de serveurs publics et gratuits, parfois très lents ou indisponibles (le 3 novembre 2026, une requête minuscule prenait 31 s sur le serveur principal et les autres ne répondaient pas). Dans ce cas :
   - si la zone a déjà été chargée une fois, l'application affiche les lieux gardés en mémoire avec le bandeau **« Lieux affichés depuis notre sauvegarde »** : c'est normal, rien n'est cassé ;
   - si la zone n'a jamais été chargée, la carte peut rester vide ou mettre jusqu'à environ 40 secondes à répondre ;
   - réessayez plus tard (quelques minutes à quelques heures). L'état du serveur principal est visible sur <https://overpass-api.de/api/status> : si la page est lente à s'ouvrir ou indique qu'aucun créneau n'est libre (« slots available » à 0), le problème vient de là ;
   - vous pouvez aussi changer l'ordre ou la liste des serveurs essayés avec la variable optionnelle `OVERPASS_ENDPOINTS` (voir [Variables d'environnement](#variables-denvironnement)).

## Pré-remplir les lieux des grandes villes

Les lieux viennent des serveurs publics Overpass (OpenStreetMap), souvent saturés. Le script `npm run places:prefetch` charge **à l'avance** les lieux du centre des grandes villes françaises et les enregistre dans la base : la carte les affiche ensuite instantanément, même quand Overpass ne répond pas.

**Quand le lancer ?** Quand Overpass va bien : ouvrez <https://overpass-api.de/api/status>. Si la page s'ouvre vite et indique au moins un créneau libre (`slots available` supérieur à 0), c'est le bon moment. Sinon, réessayez plus tard.

**Comment ?** Depuis la racine du projet, après `npm run db:migrate` :

```bash
# Voir la liste des villes disponibles et leur taille (aucun appel réseau)
npm run places:prefetch -- --list

# Compter ce qu'il reste à charger pour Paris, sans rien télécharger
npm run places:prefetch -- --city=Paris --dry-run

# Charger Paris (puis Lyon et Marseille)
npm run places:prefetch -- --city=Paris
npm run places:prefetch -- --city=Lyon,Marseille

# Toutes les villes (long : plusieurs minutes, voire plus)
npm run places:prefetch
```

> Les deux tirets `--` après `places:prefetch` sont obligatoires : ils transmettent les options au script.

**Sous macOS, empêchez la mise en veille.** Si l'ordinateur se met en veille pendant le chargement (écran fermé, inactivité), le script est suspendu : un essai a ainsi duré 19 minutes au lieu de quelques-unes. Pour l'éviter, ajoutez `caffeinate -i` devant la commande :

```bash
caffeinate -i npm run places:prefetch -- --city=Paris
```

`caffeinate` est un outil fourni avec macOS : il empêche la mise en veille tant que la commande tourne, puis tout redevient normal à la fin. Si l'ordinateur s'est tout de même mis en veille, le script le signale par le message « l'ordinateur s'est probablement mis en veille » : il vous suffit de relancer la même commande, il reprend là où il s'était arrêté.

Options utiles :

| Option | Rôle |
|---|---|
| `--city=Paris` | Ville(s) à traiter ; répétable (`--city=Paris --city=Lyon`) ou séparées par des virgules. Par défaut : toutes. |
| `--list` | Affiche les villes et leur nombre de tuiles, puis s'arrête. |
| `--dry-run` | Compte les tuiles à charger sans appeler Overpass. |
| `--force` | Recharge aussi les zones déjà chargées il y a moins de 7 jours. |
| `--pause=5` | Pause entre deux requêtes, en secondes (par défaut 5 : on reste poli avec ces serveurs gratuits). |
| `--timeout=90` | Délai maximal d'un essai, en secondes. |
| `--tiles-per-request=4` | Nombre de tuiles par requête (1 à 8). |

**Résultat** (code de sortie, utile dans un script) : `0` tout est fait ; `1` certaines tuiles ont échoué ou une erreur est survenue ; `2` le script s'est arrêté de lui-même parce qu'Overpass ne répondait plus (ou `Ctrl + C`).

**Reprise :** vous pouvez interrompre le script (`Ctrl + C`) ou le relancer après un arrêt : les zones déjà chargées depuis moins de 7 jours sont sautées, rien n'est refait inutilement.

**Base de production :** le script refuse par sécurité une base distante (Turso). Pour la remplir volontairement : `PREFETCH_ALLOW_REMOTE=1 npm run places:prefetch -- --city=Paris` (avec les variables Turso), en surveillant le quota de l'offre gratuite Turso.

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
| `npm run test:e2e` | Lance les tests de bout en bout (Playwright) dans Google Chrome, avec position et serveurs Overpass simulés. Chrome doit être installé sur l'ordinateur. |
| `npm run db:generate` | Génère une nouvelle migration Drizzle après une modification de `server/database/schema.ts`. |
| `npm run db:migrate` | Applique les migrations à la base désignée par `DATABASE_URL`. |
| `npm run db:seed` | Remplit la base avec des données de démo. |
| `npm run places:prefetch` | Pré-charge les lieux des grandes villes depuis Overpass (voir [Pré-remplir les lieux des grandes villes](#pré-remplir-les-lieux-des-grandes-villes)). |

Avant de proposer une modification : `npm run lint && npm run typecheck && npm test` doivent passer. La même vérification tourne automatiquement sur GitHub (voir `.github/workflows/ci.yml`) à chaque push et pull request vers `main`.

## Variables d'environnement

Toutes les variables sont documentées dans [`.env.example`](.env.example). Le fichier `.env` n'est **jamais** committé.

| Variable | Obligatoire | Description |
|---|---|---|
| `DATABASE_URL` | oui | Adresse de la base. En local : `file:pawspot.db`. En production : URL Turso (`libsql://…`). |
| `DATABASE_AUTH_TOKEN` | en prod | Jeton Turso. Vide en local. |
| `APP_URL` | oui | URL publique de l'app, sans `/` final (`http://localhost:3000` en local, `https://<votre-projet>.vercel.app` en production). Sert aux liens d'emails et aux balises de partage (Open Graph, canonique). Lue au build : redéployez après l'avoir modifiée. |
| `TILE_URL` | non | Modèle d'URL des tuiles de carte (avec `{z}`, `{x}`, `{y}`). Par défaut : `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, suffisant en développement. En production, un fournisseur avec offre gratuite (OpenFreeMap, MapTiler, Stadia…) : le serveur de tuiles OSM interdit l'usage intensif. Lue au build. |
| `TILE_ATTRIBUTION` | non | Mention de crédit affichée sur la carte, injectée telle quelle en HTML : n'y mettez **jamais** de contenu venant d'utilisateurs. Par défaut : « © les contributeurs d'OpenStreetMap » avec un lien vers la page de copyright OSM. À adapter si le fournisseur de tuiles impose sa mention. Lue au build. |
| `GEOCODER` | non | Fournisseur de recherche d'adresses : `photon` (par défaut) ou `nominatim`. L'instance publique de Nominatim (OSMF) **interdit l'autocomplétion** : n'utilisez `nominatim` qu'avec une instance qui l'autorise. Le cache `geocode_cache` ne distingue pas les fournisseurs : après un changement, videz cette table si vous voulez repartir de zéro. |
| `PHOTON_URL` | non | Adresse de base du service Photon, **sans** `/api` ni `/` final. Par défaut : `https://photon.komoot.io`. `http:` est accepté pour un serveur local de test (ex. `http://127.0.0.1:8089`). |
| `NOMINATIM_URL` | non | Utilisée **seulement** si `GEOCODER=nominatim`. Adresse de base du service Nominatim, **sans** `/search` ni `/` final. Par défaut : `https://nominatim.openstreetmap.org`. Exemple pour un serveur local de test de bout en bout : `http://127.0.0.1:8088`. |
| `OVERPASS_ENDPOINTS` | non | Serveurs Overpass à essayer, dans l'ordre : URLs complètes se terminant par `/api/interpreter`, séparées par des virgules. Les entrées invalides sont ignorées ; si aucune n'est valide (ou si la variable est absente), la liste par défaut est utilisée (overpass-api.de, maps.mail.ru, overpass.private.coffee, overpass.kumi.systems). |
| `PREFETCH_ALLOW_REMOTE` | non | `1` autorise `npm run places:prefetch` à écrire dans une base distante (Turso). Absent par défaut : le script n'accepte qu'une base locale. |
| `PAWSPOT_MIGRATIONS_DIR` | non | Dossier des migrations. Utile seulement si le serveur tourne avec une base locale depuis un dossier situé hors du dépôt. À laisser vide sinon. |
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
shared/             Types, schémas (Zod) et utilitaires partagés entre front et back
scripts/            Scripts de maintenance (migrations, données de démo, pré-remplissage des lieux)
tests/              Tests Vitest
  unit/server/      Tests du back (routes d'API, base, service des lieux, shared/) — environnement Node
  unit/app/         Tests du front (composants, composables, utilitaires) — environnement happy-dom
  fixtures/         Données figées (réponses Overpass…) utilisées par les tests
public/             Fichiers statiques (logo, favicon…)
```

## Mise en ligne

La mise en ligne gratuite (Vercel + Turso + Cloudflare R2 + Resend) est prévue en phase 4 : un guide pas à pas sera ajouté ici à ce moment-là.

Points déjà connus pour la phase 4 :

- **Migrations en production** : avec une base distante (Turso), les migrations ne sont **pas** appliquées automatiquement. Il faudra lancer `npm run db:migrate` (avec les variables Turso) avant chaque build de production.
- **Tuiles de la carte** : le serveur de tuiles OpenStreetMap (valeur par défaut de `TILE_URL`) interdit l'usage intensif. En production, il faudra choisir un fournisseur avec offre gratuite (par exemple OpenFreeMap), renseigner `TILE_URL` et, si le fournisseur l'exige, `TILE_ATTRIBUTION`, puis relancer un déploiement.
- **Durée d'exécution des requêtes** : la route `/api/places` peut mettre jusqu'à environ 40 secondes quand Overpass est lent (zone jamais chargée). L'hébergeur devra autoriser **au moins 45 secondes** d'exécution par requête. Sur Vercel, la limite par défaut sans « Fluid compute » est de 10 secondes : il faudra la relever (réglage `maxDuration`) au moment du déploiement.

## Sources et licences

Les données des lieux proviennent d'[OpenStreetMap](https://www.openstreetmap.org/copyright) (© contributeurs OpenStreetMap, licence ODbL).
