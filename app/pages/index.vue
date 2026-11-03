<script setup lang="ts">
/** Carte seule : tout l'écran est dans le layout `map` (la fiche vit dans `/lieu/[id]`). */
definePageMeta({ layout: 'map' })

const origin = useRequestURL().origin
const description = 'Parcs, cafés, restaurants, plages, vétos : trouvez près de chez vous les lieux qui acceptent les chiens, avec l\'avis de la communauté.'

useSeoMeta({
  title: 'PawSpot — les lieux où votre chien est le bienvenu',
  description,
  ogTitle: 'PawSpot — les lieux où votre chien est le bienvenu',
  ogDescription: description,
  ogType: 'website',
  ogSiteName: 'PawSpot',
  ogLocale: 'fr_FR',
  ogImage: `${origin}/logo/patte-de-chien.png`,
  twitterCard: 'summary',
})
</script>

<template>
  <div />
</template>
