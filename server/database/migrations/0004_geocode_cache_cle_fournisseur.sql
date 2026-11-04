-- Migration de données : la clé de `geocode_cache` devient la requête exacte envoyée
-- au fournisseur (`normalizeGeocodeQuery`). Les entrées écrites avec l'ancienne
-- clé (accents et caractères non latins retirés) ont pu associer une réponse à
-- une autre requête : on les supprime toutes. Ce n'est qu'un cache, reconstruit
-- au fil des recherches.
DELETE FROM `geocode_cache`;
