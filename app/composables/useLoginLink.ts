import type { RouteLocationRaw } from 'vue-router'

/**
 * Liens vers la connexion et l'inscription qui ramènent à la page actuelle
 * (`?redirect=<route actuelle>`). Depuis /login ou /register, le `redirect`
 * reçu est transmis tel quel (après validation).
 */
export function useLoginLink() {
  const route = useRoute()

  const redirect = computed(() =>
    AUTH_PATHS.includes(route.path) ? safeRedirect(route.query.redirect) : route.fullPath,
  )

  function linkTo(path: '/login' | '/register'): RouteLocationRaw {
    return redirect.value === '/' ? path : { path, query: { redirect: redirect.value } }
  }

  return {
    redirect,
    loginLink: computed(() => linkTo('/login')),
    registerLink: computed(() => linkTo('/register')),
  }
}
