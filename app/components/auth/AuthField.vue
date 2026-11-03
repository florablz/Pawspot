<script setup lang="ts">
/** Champ des formulaires de connexion / inscription : libellé relié (`for` / `id`), contrastes AA. */
defineProps<{
  id: string
  label: string
  type: 'email' | 'password' | 'text'
  autocomplete: string
  placeholder?: string
  minlength?: number
  maxlength?: number
  /** Aide affichée sous le champ et reliée par `aria-describedby`. */
  hint?: string
}>()

const value = defineModel<string>({ required: true })
</script>

<template>
  <div>
    <label :for="id" class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-white/70">{{ label }}</label>
    <input
      :id="id"
      v-model="value"
      :type="type"
      required
      :autocomplete="autocomplete"
      :minlength="minlength"
      :maxlength="maxlength"
      :placeholder="placeholder"
      :aria-describedby="hint ? `${id}-hint` : undefined"
      class="min-h-[44px] w-full rounded-xl bg-paw-brown-800/80 px-4 py-3 text-sm text-white placeholder-white/60 outline-none ring-1 ring-white/20 transition focus:ring-2 focus:ring-paw-orange-300"
    >
    <p v-if="hint" :id="`${id}-hint`" class="mt-1 text-xs text-white/70">{{ hint }}</p>
  </div>
</template>
