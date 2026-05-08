/**
 * CategoryIcon Component
 * Maps category names to appropriate SVG icons
 */

interface CategoryIconProps {
  name: string
  size?: number
}

const iconMap: Record<string, () => { path: string; viewBox?: string }> = {
  food: () => ({
    path: 'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2M7 2v7M3 6h5m11-1v5a2 2 0 01-2 2h-5a2 2 0 01-2-2V5a2 2 0 012-2h5a2 2 0 012 2z',
  }),
  grocery: () => ({
    path: 'M3 6h18l-1.5 8.5A2 2 0 0117.5 16h-11a2 2 0 01-2-1.5L3 6zm4 6h10M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2',
  }),
  restaurant: () => ({
    path: 'M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zm4-4v4m4-4v4m4-4v4',
  }),
  rent: () => ({
    path: 'M3 9.5L12 3l9 6.5V19a2 2 0 01-2 2H5a2 2 0 01-2-2V9.5zM9 21V12h6v9',
  }),
  housing: () => ({
    path: 'M3 9.5L12 3l9 6.5V19a2 2 0 01-2 2H5a2 2 0 01-2-2V9.5zM9 21V12h6v9',
  }),
  mortgage: () => ({
    path: 'M3 9.5L12 3l9 6.5V19a2 2 0 01-2 2H5a2 2 0 01-2-2V9.5zM9 21V12h6v9',
  }),
  home: () => ({
    path: 'M3 9.5L12 3l9 6.5V19a2 2 0 01-2 2H5a2 2 0 01-2-2V9.5zM9 21V12h6v9',
  }),
  transport: () => ({
    path: 'M5 17h14v-2H5v2zm0-4h14V7H5v6zm2-4h4v2H7V9zm6 0h4v2h-4V9zM8 16h8v1H8v-1zM3 3h2l1 1h12l1-1h2v2H3V3z',
  }),
  car: () => ({
    path: 'M5 17h14v-2H5v2zm0-4h14V7H5v6zm2-4h4v2H7V9zm6 0h4v2h-4V9zM8 16h8v1H8v-1zM3 3h2l1 1h12l1-1h2v2H3V3z',
  }),
  auto: () => ({
    path: 'M5 17h14v-2H5v2zm0-4h14V7H5v6zm2-4h4v2H7V9zm6 0h4v2h-4V9zM8 16h8v1H8v-1zM3 3h2l1 1h12l1-1h2v2H3V3z',
  }),
  gas: () => ({
    path: 'M14 11h2v5h-2zM12 7h2v9h-2zM4 21V5a2 2 0 012-2h8a2 2 0 012 2v16l-3-2-3 2-3-2-3 2z',
  }),
  fuel: () => ({
    path: 'M14 11h2v5h-2zM12 7h2v9h-2zM4 21V5a2 2 0 012-2h8a2 2 0 012 2v16l-3-2-3 2-3-2-3 2z',
  }),
  utility: () => ({
    path: 'M13 10V3L4 14h7v7l9-11h-7z',
  }),
  electric: () => ({
    path: 'M13 10V3L4 14h7v7l9-11h-7z',
  }),
  power: () => ({
    path: 'M13 10V3L4 14h7v7l9-11h-7z',
  }),
  water: () => ({
    path: 'M12 3c-3 2.5-7 6.5-7 10a7 7 0 0014 0c0-3.5-4-7.5-7-10z',
  }),
  entertainment: () => ({
    path: 'M19.82 2H4.18C2.98 2 2 2.98 2 4.18v11.64C2 17.02 2.98 18 4.18 18h5.64l2 4 2-4h5.64C20.52 18 22 17.02 22 15.82V4.18C22 2.98 20.52 2 19.82 2zM8 12h.01M12 12h.01M16 12h.01M8 8h.01M12 8h.01M16 8h.01',
  }),
  leisure: () => ({
    path: 'M19.82 2H4.18C2.98 2 2 2.98 2 4.18v11.64C2 17.02 2.98 18 4.18 18h5.64l2 4 2-4h5.64C20.52 18 22 17.02 22 15.82V4.18C22 2.98 20.52 2 19.82 2zM8 12h.01M12 12h.01M16 12h.01M8 8h.01M12 8h.01M16 8h.01',
  }),
  movie: () => ({
    path: 'M19.82 2H4.18C2.98 2 2 2.98 2 4.18v11.64C2 17.02 2.98 18 4.18 18h5.64l2 4 2-4h5.64C20.52 18 22 17.02 22 15.82V4.18C22 2.98 20.52 2 19.82 2zM8 12h.01M12 12h.01M16 12h.01M8 8h.01M12 8h.01M16 8h.01',
  }),
  film: () => ({
    path: 'M19.82 2H4.18C2.98 2 2 2.98 2 4.18v11.64C2 17.02 2.98 18 4.18 18h5.64l2 4 2-4h5.64C20.52 18 22 17.02 22 15.82V4.18C22 2.98 20.52 2 19.82 2zM8 12h.01M12 12h.01M16 12h.01M8 8h.01M12 8h.01M16 8h.01',
  }),
  healthcare: () => ({
    path: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
  }),
  medical: () => ({
    path: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
  }),
  health: () => ({
    path: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
  }),
  pharmacy: () => ({
    path: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
  }),
  shopping: () => ({
    path: 'M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0',
  }),
  clothing: () => ({
    path: 'M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0',
  }),
  education: () => ({
    path: 'M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15zM12 6v8m-4-4h8',
  }),
  book: () => ({
    path: 'M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15zM12 6v8m-4-4h8',
  }),
  school: () => ({
    path: 'M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15zM12 6v8m-4-4h8',
  }),
  salary: () => ({
    path: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
    viewBox: '0 0 24 24',
  }),
  income: () => ({
    path: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  }),
  wage: () => ({
    path: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  }),
  freelance: () => ({
    path: 'M20.24 12.24a6 6 0 00-8.48-8.48L12 3.5l-.76-.74a6 6 0 00-8.48 8.48L12 21l9.24-8.76z',
  }),
  travel: () => ({
    path: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z',
    viewBox: '0 0 24 24',
  }),
  phone: () => ({
    path: 'M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.42 19.42 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0122 16.92z',
  }),
  internet: () => ({
    path: 'M1 12h4m6-11v4m6 7h4M5.64 5.64l2.83 2.83m7.07 7.07l2.83 2.83M18.36 5.64l-2.83 2.83m-7.07 7.07l-2.83 2.83M12 2a10 10 0 110 20 10 10 0 010-20z',
  }),
  wifi: () => ({
    path: 'M1 12h4m6-11v4m6 7h4M5.64 5.64l2.83 2.83m7.07 7.07l2.83 2.83M18.36 5.64l-2.83 2.83m-7.07 7.07l-2.83 2.83M12 2a10 10 0 110 20 10 10 0 010-20z',
  }),
  subscription: () => ({
    path: 'M16 4l4 4-4 4M20 8H4M8 20l-4-4 4-4M4 16h16',
  }),
  insurance: () => ({
    path: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  }),
  pet: () => ({
    path: 'M8 7a4 4 0 108 0 4 4 0 00-8 0zm-7 8a5 5 0 015-5h12a5 5 0 015 5v1H1v-1zm4 5h14M8 20v-3m8 3v-3',
  }),
  fitness: () => ({
    path: 'M6.5 6.5l11 11M17.5 6.5l-11 11M3.5 12h2m13 0h2M12 3.5v2m0 13v2',
  }),
  gym: () => ({
    path: 'M6.5 6.5l11 11M17.5 6.5l-11 11M3.5 12h2m13 0h2M12 3.5v2m0 13v2',
  }),
  gift: () => ({
    path: 'M20 12v10H4V12M2 8h20v4H2zM12 8v14M12 8a3 3 0 00-3-3H8a2 2 0 000 4h4zm0 0a3 3 0 013-3h1a2 2 0 010 4h-4z',
  }),
  charity: () => ({
    path: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z',
  }),
  saving: () => ({
    path: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
    viewBox: '0 0 24 24',
  }),
  investment: () => ({
    path: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  }),
  tax: () => ({
    path: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z',
  }),
  coffee: () => ({
    path: 'M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3m4-3v3m4-3v3',
  }),
  cafe: () => ({
    path: 'M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3m4-3v3m4-3v3',
  }),
  child: () => ({
    path: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  }),
  bank: () => ({
    path: 'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11m16-11v11M8 14v3m4-3v3m4-3v3',
  }),
  business: () => ({
    path: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12l8.73-5.04M12 22.08V12',
    viewBox: '0 0 24 24',
  }),
  office: () => ({
    path: 'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12l8.73-5.04M12 22.08V12',
  }),
}

function findIcon(categoryName: string): (() => { path: string; viewBox?: string }) | null {
  const lower = categoryName.toLowerCase()
  // Direct match first
  if (iconMap[lower]) return iconMap[lower]
  // Partial match
  for (const [key, icon] of Object.entries(iconMap)) {
    if (lower.includes(key) || key.includes(lower)) return icon
  }
  return null
}

export function getCategorySvg(name: string, size = 18) {
  const icon = findIcon(name)
  if (!icon) return null
  const { path, viewBox = '0 0 24 24' } = icon()
  return (
    <svg width={size} height={size} fill="none" stroke="currentColor" stroke-width="2" viewBox={viewBox}>
      <path stroke-linecap="round" stroke-linejoin="round" d={path} />
    </svg>
  )
}

export default function CategoryIcon(props: CategoryIconProps) {
  return getCategorySvg(props.name, props.size)
}
