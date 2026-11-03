import type * as Leaflet from 'leaflet'
import { CATEGORIES, DEFAULT_CATEGORY_COLOR, DEFAULT_CATEGORY_ICON } from '#shared/categories'
import type { Place } from '#shared/types'

/**
 * Icônes Leaflet de la carte (HTML brut : uniquement des valeurs de
 * configuration, jamais de donnée d'un lieu). Les libellés accessibles sont
 * posés sur l'élément par `PawspotMap` (`setAttribute`, pas de HTML).
 */

/** Taille minimale de la zone cliquable d'un marqueur ou d'un groupe (px). */
export const MARKER_HIT_SIZE = 44

/** Icônes partagées entre marqueurs (même catégorie, même statut, même état). */
const placeIconCache = new Map<string, Leaflet.DivIcon>()

export function placeIcon(lib: typeof Leaflet, place: Pick<Place, 'category' | 'dogStatus'>, selected: boolean): Leaflet.DivIcon {
  const key = `${place.category}|${place.dogStatus}|${selected ? 1 : 0}`
  let icon = placeIconCache.get(key)
  if (!icon) {
    icon = createPlaceIcon(lib, place, selected)
    placeIconCache.set(key, icon)
  }
  return icon
}

function createPlaceIcon(lib: typeof Leaflet, place: Pick<Place, 'category' | 'dogStatus'>, selected: boolean): Leaflet.DivIcon {
  const category = CATEGORIES[place.category]
  const color = category?.color ?? DEFAULT_CATEGORY_COLOR
  const emoji = category?.icon ?? DEFAULT_CATEGORY_ICON
  const dot = DOG_STATUS_MARKER[place.dogStatus] ?? DOG_STATUS_MARKER.unknown
  const size = selected ? 44 : 36
  /** Zone tactile : 44 px au moins, le disque visible est centré dedans. */
  const hit = Math.max(MARKER_HIT_SIZE, size)
  const dotSize = selected ? 20 : 18
  // Symbole de deux caractères (✓✓) : police plus petite et lettres resserrées.
  const glyphSize = dot.glyph.length > 1 ? dotSize - 10 : dotSize - 7
  const border = selected ? '3px solid #ffffff' : '2px solid rgba(255,255,255,0.3)'
  const shadow = selected
    ? '0 0 16px rgba(255,255,255,0.3), 0 2px 8px rgba(0,0,0,0.4)'
    : '0 2px 8px rgba(0,0,0,0.4)'
  return lib.divIcon({
    className: '',
    html: `<div style="
      width:${hit}px;height:${hit}px;
      display:flex;align-items:center;justify-content:center;
      cursor:pointer;
    "><div style="
      position:relative;
      width:${size}px;height:${size}px;
      background:${color};
      border:${border};
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:${selected ? 20 : 16}px;
      box-shadow:${shadow};
      cursor:pointer;
      transition:all 0.2s;
    "><span aria-hidden="true">${emoji}</span><span aria-hidden="true" style="
      position:absolute;top:-4px;right:-4px;
      width:${dotSize}px;height:${dotSize}px;
      border-radius:50%;
      background:${dot.color};
      color:${dot.glyphColor};
      border:2px ${dot.dashed ? 'dashed' : 'solid'} #2C1810;
      font:700 ${glyphSize}px/1 system-ui,sans-serif;
      letter-spacing:${dot.glyph.length > 1 ? '-1px' : '0'};
      display:flex;align-items:center;justify-content:center;
    ">${dot.glyph}</span></div></div>`,
    iconSize: [hit, hit],
    iconAnchor: [hit / 2, hit / 2],
    popupAnchor: [0, -size / 2],
  })
}

/** Taille d'une bulle de groupe selon le nombre de lieux (≥ 44 px). */
export function clusterSize(count: number): number {
  if (count >= 1000) return 60
  if (count >= 100) return 52
  return MARKER_HIT_SIZE + 4
}

/** Nombre affiché dans la bulle : « 1,2 k » au-delà de 9 999 pour rester lisible. */
export function clusterCountText(count: number): string {
  if (count < 10_000) return String(count)
  return `${(count / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`
}

/** Libellé accessible d'un groupe (« 12 lieux, zoomer pour les voir »). */
export function clusterLabel(count: number): string {
  return `${count} lieu${count > 1 ? 'x' : ''}, zoomer pour les voir`
}

/** Bulle de groupe : disque marron cerclé d'orange, nombre en blanc (styles dans main.css). */
export function clusterIcon(lib: typeof Leaflet, count: number): Leaflet.DivIcon {
  const size = clusterSize(count)
  const icon = lib.divIcon({
    className: 'paw-cluster',
    html: `<span class="paw-cluster__disc" style="width:${size}px;height:${size}px" aria-hidden="true">${clusterCountText(count)}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
  // L'élément créé est le bouton focusable du groupe (Leaflet y pose tabindex + role="button").
  const create = icon.createIcon.bind(icon)
  icon.createIcon = (oldIcon?: HTMLElement) => {
    const el = create(oldIcon)
    el.setAttribute('aria-label', clusterLabel(count))
    return el
  }
  return icon
}

/** Repère décoratif de la position de l'utilisateur. */
export function userIcon(lib: typeof Leaflet): Leaflet.DivIcon {
  return lib.divIcon({
    className: '',
    html: `<div style="position:relative;width:18px;height:18px;">
      <div style="
        position:absolute;inset:-8px;
        border-radius:50%;
        background:rgba(255,109,0,0.25);
        animation:pulse-ring 2s ease-out infinite;
      "></div>
      <div style="
        width:18px;height:18px;
        background:#FF6D00;
        border:3px solid #ffffff;
        border-radius:50%;
        box-shadow:0 0 12px rgba(255,109,0,0.6);
      "></div>
    </div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}
