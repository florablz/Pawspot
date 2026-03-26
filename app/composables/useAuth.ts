import type { User } from '~/types/auth'

export const useAuth = () => {
  const user = useState<User | null>('auth-user', () => null)
  const loggedIn = computed(() => !!user.value)

  async function fetchUser() {
    try {
      const data = await $fetch<{ user: User | null }>('/api/auth/me')
      user.value = data.user
    } catch {
      user.value = null
    }
  }

  async function login(email: string, password: string) {
    const data = await $fetch<User>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    })
    user.value = data
  }

  async function register(email: string, username: string, password: string) {
    const data = await $fetch<User>('/api/auth/register', {
      method: 'POST',
      body: { email, username, password },
    })
    user.value = data
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
  }

  return { user, loggedIn, fetchUser, login, register, logout }
}
