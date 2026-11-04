import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { CATEGORIES, CATEGORY_LIST } from '#shared/categories'
import type { CategoryKey } from '#shared/categories'
import CategoryFilters from '~/components/search/CategoryFilters.vue'

beforeEach(() => {
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('onMounted', onMounted)
  vi.stubGlobal('onBeforeUnmount', onBeforeUnmount)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mountFilters(props: { categories?: CategoryKey[], confirmedOnly?: boolean } = {}) {
  const wrapper = mount(CategoryFilters, {
    props: {
      'categories': props.categories ?? [],
      'confirmedOnly': props.confirmedOnly ?? false,
      'onUpdate:categories': (value: CategoryKey[]) => wrapper.setProps({ categories: value }),
      'onUpdate:confirmedOnly': (value: boolean) => wrapper.setProps({ confirmedOnly: value }),
    },
  })
  return wrapper
}

const confirmedChip = (wrapper: ReturnType<typeof mountFilters>) => wrapper.get('[data-testid="filter-confirmed"]')

describe('CategoryFilters', () => {
  it('groupe nommé « Filtres » : « Confirmés » en tête, puis une puce par catégorie', () => {
    const wrapper = mountFilters()
    expect(wrapper.get('[role="group"]').attributes('aria-label')).toBe('Filtres')
    const buttons = wrapper.get('[role="group"]').findAll('button')
    expect(buttons).toHaveLength(CATEGORY_LIST.length + 1)
    expect(buttons[0]!.attributes('data-testid')).toBe('filter-confirmed')
  })

  it('catégories les plus cherchées d\'abord (visibles sans défiler à 375 px), puis les autres', () => {
    const labels = mountFilters().get('[role="group"]').findAll('button').slice(1).map(b => b.text())
    const first = ['restaurant', 'cafe', 'bar', 'park', 'dog_park', 'beach', 'vet'] as const
    const expected = first.map(k => CATEGORIES[k]).filter(Boolean).map(c => `${c.icon}${c.label}`)
    expect(labels.slice(0, expected.length)).toEqual(expected)
    // Chaque catégorie une seule fois.
    expect(new Set(labels).size).toBe(CATEGORY_LIST.length)
  })

  describe('puce « ✅ Confirmés »', () => {
    it('texte court visible et nom accessible explicite (qui contient le texte visible)', () => {
      const chip = confirmedChip(mountFilters())
      expect(chip.text()).toBe('✅Confirmés')
      const label = chip.attributes('aria-label')!
      expect(label).toBe('Chiens acceptés confirmés uniquement')
      expect(label.toLowerCase()).toContain('confirmés')
      expect(chip.attributes('type')).toBe('button')
      expect(chip.classes()).toContain('min-h-[44px]')
    })

    it('aria-pressed suit le filtre, et le clic le bascule', async () => {
      const wrapper = mountFilters()
      expect(confirmedChip(wrapper).attributes('aria-pressed')).toBe('false')
      await confirmedChip(wrapper).trigger('click')
      expect(wrapper.emitted('update:confirmedOnly')).toEqual([[true]])
      expect(confirmedChip(wrapper).attributes('aria-pressed')).toBe('true')
      await confirmedChip(wrapper).trigger('click')
      expect(wrapper.emitted('update:confirmedOnly')!.at(-1)).toEqual([false])
      expect(confirmedChip(wrapper).attributes('aria-pressed')).toBe('false')
    })

    it('ne touche pas aux catégories', async () => {
      const wrapper = mountFilters({ categories: ['park'] })
      await confirmedChip(wrapper).trigger('click')
      expect(wrapper.emitted('update:categories')).toBeUndefined()
    })
  })

  describe('puces de catégorie', () => {
    const chip = (wrapper: ReturnType<typeof mountFilters>, label: string) =>
      wrapper.findAll('button').find(b => b.text().includes(label))!

    it('multi-sélection : ajout puis retrait, aria-pressed à jour', async () => {
      const [first, second] = CATEGORY_LIST
      const wrapper = mountFilters()
      expect(chip(wrapper, first!.label).attributes('aria-pressed')).toBe('false')

      await chip(wrapper, first!.label).trigger('click')
      await chip(wrapper, second!.label).trigger('click')
      expect(wrapper.props('categories')).toEqual([first!.key, second!.key])
      expect(chip(wrapper, first!.label).attributes('aria-pressed')).toBe('true')

      await chip(wrapper, first!.label).trigger('click')
      expect(wrapper.props('categories')).toEqual([second!.key])
      expect(chip(wrapper, first!.label).attributes('aria-pressed')).toBe('false')
    })
  })

  it('flèches de défilement hors de l\'ordre de tabulation et masquées aux lecteurs d\'écran', () => {
    const wrapper = mountFilters()
    const arrows = wrapper.findAll('button').filter(b => b.attributes('tabindex') === '-1')
    expect(arrows).toHaveLength(2)
    for (const a of arrows) expect(a.attributes('aria-hidden')).toBe('true')
  })
})
