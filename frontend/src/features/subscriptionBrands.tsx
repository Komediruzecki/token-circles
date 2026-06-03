/**
 * Subscription Brand Mappings
 *
 * Modular brand system: each entry maps name keywords → brand identity.
 * To add a new brand, add one entry to BRANDS below.
 * To add an icon, define a function returning JSX in the icons object.
 */

/** @jsxImportSource solid-js */

interface SubscriptionBrand {
  keywords: string[]
  displayName: string
  color: string
  bgColor: string
  icon: () => any
  defaultCategory: string
}

/* ── SVG Icons ── */

function NetflixIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M4 3h3l5 11.5L17 3h3v18h-2.5V8.5L13.5 20h-2L7.5 8.5V21H4V3z" fill="currentColor" />
    </svg>
  )
}

function YoutubeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M22.54 6.42a2.78 2.78 0 00-1.94-1.96C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 00-1.94 1.96A29.9 29.9 0 001 11.75a29.9 29.9 0 00.46 5.33 2.78 2.78 0 001.94 1.96C5.12 19.5 12 19.5 12 19.5s6.88 0 8.6-.46a2.78 2.78 0 001.94-1.96 29.9 29.9 0 00.46-5.33 29.9 29.9 0 00-.46-5.33z"
        fill="currentColor"
      />
      <path d="M9.75 15.02l5.75-3.27-5.75-3.27v6.54z" fill="#fff" />
    </svg>
  )
}

function SpotifyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424a.623.623 0 01-.857.206c-2.348-1.434-5.304-1.759-8.785-.964a.624.624 0 01-.277-1.215c3.809-.87 7.076-.496 9.713 1.116a.623.623 0 01.206.857zm1.224-2.722a.78.78 0 01-1.072.257c-2.687-1.652-6.785-2.131-9.965-1.166a.78.78 0 01-.459-1.49c3.633-1.102 8.147-.568 11.24 1.328a.78.78 0 01.256 1.071zm.105-2.836c-3.223-1.914-8.54-2.09-11.618-1.156a.936.936 0 01-.547-1.79c3.532-1.072 9.404-.865 13.115 1.338a.936.936 0 01-.95 1.608z"
        fill="currentColor"
      />
    </svg>
  )
}

function DisneyPlusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M5.636 2h5.91l-2.954 8.182L11.546 2h5.909l-4.432 12.273L16.6 22h-5.909l2.954-8.182L10.69 22H4.782l4.431-12.273L5.636 2z"
        fill="currentColor"
      />
    </svg>
  )
}

function HBOMaxIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="8" cy="12" r="3" fill="currentColor" />
      <circle cx="16" cy="12" r="3" fill="currentColor" />
      <line x1="11" y1="12" x2="13" y2="12" stroke="currentColor" stroke-width="2" />
    </svg>
  )
}

function HuluIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="5" width="5" height="14" rx="1" fill="currentColor" />
      <rect x="10" y="5" width="5" height="14" rx="1" fill="currentColor" />
      <rect x="17" y="5" width="5" height="14" rx="1" fill="currentColor" />
      <rect x="3" y="9" width="19" height="6" rx="1" fill="#fff" opacity="0.3" />
    </svg>
  )
}

function AmazonIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M13.5 2c-3 0-5.5 1.5-7 3.5C5.5 3.5 3 2 1.5 2c-.5 0-.5.5 0 1 1.5 1 3 3 3 5.5 0 2-1.5 3.5-3 4-.5 0-.5.5 0 1 1-.5 3-2 4.5-4 1 1.5 3 2.5 5 2.5 2.5 0 4.5-1.5 5.5-3.5 1 1.5 2.5 2.5 4 3 .5.5 1 0 1-.5-.5-.5-1.5-1-2.5-3 1.5-1.5 2-3.5 2-5.5 0-2 1-3 2-4 .5-.5 0-1-.5-.5-1.5.5-3 1.5-4 3-1-1.5-3-2.5-5.5-2.5z"
        fill="currentColor"
      />
      <path
        d="M3 19.5c0 .5.5.5 1 .5 1 0 2.5-1 4-1 1.5 0 3 .5 5 .5s3.5-.5 5-.5 3 1 4 1c.5 0 1 0 1-.5-.5-1-1.5-2-3-2-1.5 0-3 .5-5 .5s-3.5-.5-5-.5-3 .5-5 .5c-1 0-2-.5-2-1.5 0-1 1-1.5 2-1.5v-1c-2 0-3.5 1-3.5 2.5z"
        fill="currentColor"
      />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M21.35 11.1h-9.17v2.73h5.51c-.4 2.1-2.1 3.7-4.2 3.7-2.5 0-4.6-2.1-4.6-4.6s2.1-4.6 4.6-4.6c1.1 0 2.1.4 2.9 1.1l2-2C17.2 6.2 15.1 5.3 12.7 5.3c-3.8 0-6.9 3.1-6.9 6.9s3.1 6.9 6.9 6.9c3.4 0 6.3-2.4 6.6-5.5.1-.8 0-1.6 0-2.5z"
        fill="#4285F4"
      />
      <path
        d="M21.35 11.1h-9.17v2.73h5.51c-.36 1.62-1.3 2.67-2.1 3.33l-.01.01.01-.01c.7-.5 1.6-1.3 2-2.4l-2.2.02c.7.1 2.2-.6 2.7-2.1"
        fill="#34A853"
      />
      <path
        d="M17.7 17.16c-.7.5-1.6.8-2.6.8-2.1 0-3.8-1.6-4.2-3.6l.01-.02H6.38a6.6 6.6 0 006.6 5.1c2 0 3.8-.8 5-2.2l-.28-.08z"
        fill="#FBBC05"
      />
      <path
        d="M11 14.36c.2 1.1 1.1 1.9 2.2 1.9.7 0 1.3-.2 1.8-.7l-3.5 2.2c.9.6 2 .9 3.1.9 3.4 0 6.1-2.8 6.1-6.2 0-.5 0-1-.1-1.5H13.4"
        fill="#EA4335"
      />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.5-3.24 0-1.44.6-2.2.42-3.05-.4C3.92 16.72 4.5 8.83 9.05 8.57c1.12.06 1.9.62 2.55.62.63 0 1.82-.78 3.08-.66 1.31.1 2.28.62 2.93 1.57-2.6 1.55-1.97 4.96.4 5.92-.5 1.37-1.16 2.73-1.97 4.28l.01-.02zM12.03 8.45C11.87 6.17 13.68 4.3 15.68 4c.21 2.62-2.35 4.57-3.65 4.45z"
        fill="currentColor"
      />
    </svg>
  )
}

function MicrosoftIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="9.5" height="9.5" rx="1" fill="#F25022" />
      <rect x="12.5" y="2" width="9.5" height="9.5" rx="1" fill="#7FBA00" />
      <rect x="2" y="12.5" width="9.5" height="9.5" rx="1" fill="#00A4EF" />
      <rect x="12.5" y="12.5" width="9.5" height="9.5" rx="1" fill="#FFB900" />
    </svg>
  )
}

function GithubIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"
        fill="currentColor"
      />
    </svg>
  )
}

function DropboxIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M6 2l6 4.5L6 11 0 6.5 6 2z" fill="#0061FF" />
      <path d="M18 2l6 4.5L18 11l-6-4.5L18 2z" fill="#0061FF" />
      <path d="M6 13l6 4.5L6 22l-6-4.5L6 13z" fill="#0061FF" />
      <path d="M18 13l6 4.5L18 22l-6-4.5L18 13z" fill="#0061FF" opacity="0.6" />
    </svg>
  )
}

function DiscordIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.175 1.095 2.157 2.42 0 1.333-.955 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.175 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z"
        fill="currentColor"
      />
    </svg>
  )
}

function GenericSubscriptionIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

/* ── Brand Registry ── */

const ICONS: Record<string, () => any> = {
  netflix: NetflixIcon,
  youtube: YoutubeIcon,
  spotify: SpotifyIcon,
  disney: DisneyPlusIcon,
  hbo: HBOMaxIcon,
  hulu: HuluIcon,
  amazon: AmazonIcon,
  google: GoogleIcon,
  apple: AppleIcon,
  microsoft: MicrosoftIcon,
  github: GithubIcon,
  dropbox: DropboxIcon,
  discord: DiscordIcon,
}

const BRANDS: SubscriptionBrand[] = [
  {
    keywords: ['netflix'],
    displayName: 'Netflix',
    color: '#E50914',
    bgColor: 'rgba(229,9,20,0.08)',
    icon: NetflixIcon,
    defaultCategory: 'Streaming',
  },
  {
    keywords: ['youtube', 'yt premium', 'youtube premium'],
    displayName: 'YouTube',
    color: '#FF0000',
    bgColor: 'rgba(255,0,0,0.08)',
    icon: YoutubeIcon,
    defaultCategory: 'Streaming',
  },
  {
    keywords: ['spotify'],
    displayName: 'Spotify',
    color: '#1DB954',
    bgColor: 'rgba(29,185,84,0.08)',
    icon: SpotifyIcon,
    defaultCategory: 'Music',
  },
  {
    keywords: ['disney', 'disney+', 'disney plus'],
    displayName: 'Disney+',
    color: '#113CCF',
    bgColor: 'rgba(17,60,207,0.08)',
    icon: DisneyPlusIcon,
    defaultCategory: 'Streaming',
  },
  {
    keywords: ['hbo', 'hbo max', 'max'],
    displayName: 'HBO Max',
    color: '#5822B4',
    bgColor: 'rgba(88,34,180,0.08)',
    icon: HBOMaxIcon,
    defaultCategory: 'Streaming',
  },
  {
    keywords: ['hulu'],
    displayName: 'Hulu',
    color: '#1CE783',
    bgColor: 'rgba(28,231,131,0.08)',
    icon: HuluIcon,
    defaultCategory: 'Streaming',
  },
  {
    keywords: ['amazon prime', 'amazon', 'prime video'],
    displayName: 'Amazon Prime',
    color: '#FF9900',
    bgColor: 'rgba(255,153,0,0.08)',
    icon: AmazonIcon,
    defaultCategory: 'Shopping',
  },
  {
    keywords: ['google', 'gmail', 'google one', 'google drive', 'google workspace'],
    displayName: 'Google',
    color: '#4285F4',
    bgColor: 'rgba(66,133,244,0.08)',
    icon: GoogleIcon,
    defaultCategory: 'Cloud',
  },
  {
    keywords: ['apple', 'icloud', 'apple music', 'apple tv', 'apple tv+'],
    displayName: 'Apple',
    color: '#000000',
    bgColor: 'rgba(0,0,0,0.06)',
    icon: AppleIcon,
    defaultCategory: 'Cloud',
  },
  {
    keywords: ['microsoft', 'office 365', 'onedrive', 'xbox', 'xbox live', 'xbox game pass'],
    displayName: 'Microsoft',
    color: '#00A4EF',
    bgColor: 'rgba(0,164,239,0.08)',
    icon: MicrosoftIcon,
    defaultCategory: 'Software',
  },
  {
    keywords: ['github', 'gitlab'],
    displayName: 'GitHub',
    color: '#181717',
    bgColor: 'rgba(24,23,23,0.06)',
    icon: GithubIcon,
    defaultCategory: 'Development',
  },
  {
    keywords: ['dropbox'],
    displayName: 'Dropbox',
    color: '#0061FF',
    bgColor: 'rgba(0,97,255,0.08)',
    icon: DropboxIcon,
    defaultCategory: 'Cloud',
  },
  {
    keywords: ['discord'],
    displayName: 'Discord',
    color: '#5865F2',
    bgColor: 'rgba(88,101,242,0.08)',
    icon: DiscordIcon,
    defaultCategory: 'Communication',
  },
]

/* ── Public API ── */

export interface SubscriptionBrandMatch {
  displayName: string
  color: string
  bgColor: string
  icon: () => any
  defaultCategory: string
}

const FALLBACK: SubscriptionBrandMatch = {
  displayName: '',
  color: '#6366f1',
  bgColor: 'rgba(99,102,241,0.08)',
  icon: GenericSubscriptionIcon,
  defaultCategory: 'Other',
}

/**
 * Match a subscription name to a known brand.
 * Returns brand identity info or a sensible fallback.
 */
export function matchBrand(name: string, categoryColor?: string): SubscriptionBrandMatch {
  const lower = name.toLowerCase().trim()
  for (const brand of BRANDS) {
    for (const kw of brand.keywords) {
      if (lower.includes(kw)) {
        return {
          displayName: brand.displayName,
          color: brand.color,
          bgColor: brand.bgColor,
          icon: brand.icon,
          defaultCategory: brand.defaultCategory,
        }
      }
    }
  }
  return {
    ...FALLBACK,
    color: categoryColor || FALLBACK.color,
    bgColor: categoryColor
      ? categoryColor
          .replace(')', ',0.08)')
          .replace('rgb', 'rgba')
          .replace(/rgba\(([^,]+,[^,]+,[^,]+),/, 'rgba($1,')
      : FALLBACK.bgColor,
  }
}

export { BRANDS, GenericSubscriptionIcon, ICONS }
export type { SubscriptionBrand }
