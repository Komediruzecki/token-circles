/**
 * API access — personal access tokens for the MCP server and the account API.
 *
 * The Settings panel behind `/mcp` and `/api/v1/*`. Until this existed a token could only be
 * minted with curl, which is why the feature shipped without a user-facing changelog line.
 *
 * The one rule the whole screen is built around: the worker returns the token secret exactly
 * once, on create, and stores only a SHA-256 hash (see worker/src/apitoken.ts). It cannot be
 * shown again, so the reveal is a modal you have to acknowledge rather than a line in the table
 * that a stray refresh would take away.
 */
import { createSignal, For, onMount, Show } from 'solid-js'
import { toast } from '../core/api'
import { API_ORIGIN, apiFetch } from '../core/apiFetch'
import { activeProfileId } from '../core/apiProfileScope'
import { showConfirm } from '../core/confirmStore'
import styles from './ApiAccess.module.css'

/** The scopes the worker accepts; `VALID_SCOPES` in worker/src/routes/api-tokens.ts. */
const SCOPES = [
  { id: 'read', label: 'Read', hint: 'Transactions, budgets, reference data, snapshots' },
  { id: 'write', label: 'Write', hint: 'Add transactions, categorize, tag rules, budgets' },
  { id: 'import', label: 'Import', hint: 'Upload statements and undo import batches' },
] as const

type ScopeId = (typeof SCOPES)[number]['id']

interface ApiToken {
  id: string
  name: string
  hint: string
  scopes: string[]
  default_profile_id: number | null
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

interface Profile {
  id: number
  name: string
}

interface MintedToken {
  id: string
  secret: string
  hint: string
}

/** Dates arrive as SQLite `datetime('now')` strings; show the day, not the second. */
function shortDate(value: string | null): string {
  if (!value) return ''
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  return isNaN(d.getTime()) ? value : d.toLocaleDateString()
}

export default function ApiAccess() {
  const [tokens, setTokens] = createSignal<ApiToken[]>([])
  const [profiles, setProfiles] = createSignal<Profile[]>([])
  const [loading, setLoading] = createSignal(true)
  const [creating, setCreating] = createSignal(false)

  const [name, setName] = createSignal('')
  const [scopes, setScopes] = createSignal<ScopeId[]>(['read'])
  const [profileId, setProfileId] = createSignal<number | null>(null)

  // Held only until the user acknowledges it. Never written anywhere else.
  const [minted, setMinted] = createSignal<MintedToken | null>(null)
  const [copied, setCopied] = createSignal(false)

  const profileName = (id: number | null): string =>
    id === null ? 'First profile' : (profiles().find((p) => p.id === id)?.name ?? `Profile ${id}`)

  async function loadTokens(): Promise<void> {
    const res = await apiFetch('/api/account/api-tokens', { credentials: 'include' })
    if (!res.ok) throw new Error('Could not load tokens')
    const body = (await res.json()) as { tokens: ApiToken[] }
    setTokens(body.tokens ?? [])
  }

  onMount(() => {
    void (async () => {
      try {
        const profilesRes = await apiFetch('/api/profiles', { credentials: 'include' })
        if (profilesRes.ok) {
          const rows = (await profilesRes.json()) as Profile[]
          setProfiles(rows)
          setProfileId(rows.some((p) => p.id === activeProfileId()) ? activeProfileId() : null)
        }
        await loadTokens()
      } catch {
        toast('Could not load API tokens', 'error')
      } finally {
        setLoading(false)
      }
    })()
  })

  const canCreate = (): boolean => name().trim().length > 0 && scopes().length > 0 && !creating()

  function toggleScope(id: ScopeId): void {
    setScopes((current) =>
      current.includes(id) ? current.filter((s) => s !== id) : [...current, id]
    )
  }

  async function createToken(): Promise<void> {
    // The button is disabled in this state; the guard is for the keyboard path.
    if (!canCreate()) return
    setCreating(true)
    try {
      const res = await apiFetch('/api/account/api-tokens', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name().trim(),
          scopes: scopes(),
          defaultProfileId: profileId(),
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        toast(body.error ?? 'Could not create the token', 'error')
        return
      }
      setMinted((await res.json()) as MintedToken)
      setCopied(false)
      setName('')
      setScopes(['read'])
      await loadTokens()
    } catch {
      toast('Could not create the token', 'error')
    } finally {
      setCreating(false)
    }
  }

  async function revokeToken(token: ApiToken): Promise<void> {
    // Named, not just confirmed: the rows differ only by an eight-character hint.
    const ok = await showConfirm(
      `Revoke "${token.name}"? Anything still using this token stops working immediately.`
    )
    if (!ok) return
    try {
      const res = await apiFetch(`/api/account/api-tokens/${token.id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        toast('Could not revoke the token', 'error')
        return
      }
      await loadTokens()
      toast(`"${token.name}" revoked`, 'success')
    } catch {
      toast('Could not revoke the token', 'error')
    }
  }

  /** Where an MCP client connects. VITE_API_URL is the API origin; same-origin builds leave it
   *  empty, in which case the SPA's own origin is correct. */
  const mcpUrl = (): string => `${API_ORIGIN || window.location.origin}/mcp`

  async function copySecret(): Promise<void> {
    const secret = minted()?.secret
    if (!secret) return
    try {
      await window.navigator.clipboard.writeText(secret)
      setCopied(true)
    } catch {
      // Clipboard is unavailable over plain HTTP and when permission is refused. The secret is
      // on screen and selectable, so say so rather than implying the token failed to create.
      toast('Could not copy — select the token and copy it manually', 'error')
    }
  }

  return (
    <div>
      <div class={styles.intro}>
        <p>
          A personal access token lets Claude, or any other MCP client, work with this account.
          Tokens carry only the scopes you grant and can be revoked at any time.
        </p>
      </div>

      <div class={styles.createForm} data-test-id="api-token-create">
        <div class={styles.field}>
          <label class={styles.label} for="api-token-name">
            Token name
          </label>
          <input
            id="api-token-name"
            class={styles.input}
            type="text"
            placeholder="e.g. Claude on my laptop"
            maxlength="100"
            value={name()}
            onInput={(e) => {
              setName(e.currentTarget.value)
            }}
          />
          <p class={styles.hint}>So you can tell it apart later — only you ever see this.</p>
        </div>

        <div class={styles.field}>
          <span class={styles.label}>Scopes</span>
          <For each={SCOPES}>
            {(scope) => (
              <label class={styles.scope}>
                <input
                  type="checkbox"
                  checked={scopes().includes(scope.id)}
                  onChange={() => {
                    toggleScope(scope.id)
                  }}
                />
                <span>
                  <strong>{scope.label}</strong>
                  <span class={styles.hint}>{scope.hint}</span>
                </span>
              </label>
            )}
          </For>
        </div>

        <div class={styles.field}>
          <label class={styles.label} for="api-token-profile">
            Default profile
          </label>
          <select
            id="api-token-profile"
            class={styles.input}
            value={profileId() === null ? '' : String(profileId())}
            onChange={(e) => {
              setProfileId(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))
            }}
          >
            <option value="">No default — use the first profile</option>
            <For each={profiles()}>
              {(profile) => <option value={String(profile.id)}>{profile.name}</option>}
            </For>
          </select>
          <p class={styles.hint}>
            Which profile a request acts on when it does not name one. Worth setting if you have
            more than one, so a client cannot write into the wrong ledger.
          </p>
        </div>

        <button
          type="button"
          class={styles.primaryBtn}
          disabled={!canCreate()}
          onClick={() => {
            void createToken()
          }}
        >
          {creating() ? 'Creating…' : 'Create token'}
        </button>
      </div>

      <Show when={!loading()} fallback={<p class={styles.empty}>Loading…</p>}>
        <Show when={tokens().length > 0} fallback={<p class={styles.empty}>No tokens yet.</p>}>
          <ul class={styles.list} data-test-id="api-token-list">
            <For each={tokens()}>
              {(token) => (
                <li class={token.revoked_at ? styles.rowRevoked : styles.row}>
                  <div class={styles.rowMain}>
                    <span class={styles.rowName}>{token.name}</span>
                    <code class={styles.hintCode}>tc_pat_{token.hint}…</code>
                    <Show when={token.revoked_at}>
                      <span class={styles.badgeRevoked}>Revoked</span>
                    </Show>
                  </div>
                  <div class={styles.rowScopes}>
                    <For each={token.scopes}>
                      {(scope) => <span class={styles.badge}>{scope}</span>}
                    </For>
                    <span class={styles.rowMeta}>{profileName(token.default_profile_id)}</span>
                  </div>
                  <div class={styles.rowMeta}>
                    Created {shortDate(token.created_at)}
                    {' · '}
                    {token.last_used_at ? (
                      `Last used ${shortDate(token.last_used_at)}`
                    ) : (
                      // Worth calling out: a token that never reported use is usually one that
                      // was pasted somewhere it never worked.
                      <span class={styles.neverUsed}>Never used</span>
                    )}
                  </div>
                  <Show when={!token.revoked_at}>
                    <button
                      type="button"
                      class={styles.revokeBtn}
                      onClick={() => {
                        void revokeToken(token)
                      }}
                    >
                      Revoke
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>

      <Show when={minted()}>
        {(token) => (
          <div class={styles.overlay} data-test-id="api-token-reveal">
            {/* No overlay click-to-close and no escape hatch: closing without saving the secret
                loses it for good, so the acknowledgement is the only way out. */}
            <div class={styles.dialog} role="alertdialog" aria-modal="true">
              <h3 class={styles.dialogTitle}>Copy your token now</h3>
              <p class={styles.dialogBody}>
                This is the only time it can be shown. We store only a hash of it, so if you lose it
                you will need to revoke this token and create another.
              </p>
              <code class={styles.secret}>{token().secret}</code>
              <button
                type="button"
                class={styles.copyBtn}
                onClick={() => {
                  void copySecret()
                }}
              >
                {copied() ? 'Copied' : 'Copy token'}
              </button>

              <p class={styles.dialogBody}>Point an MCP client at:</p>
              <code class={styles.config}>
                {mcpUrl()}
                {'\n'}Authorization: Bearer {token().secret}
              </code>

              <button
                type="button"
                class={styles.primaryBtn}
                data-test-id="api-token-ack"
                onClick={() => {
                  setMinted(null)
                }}
              >
                I&rsquo;ve saved it
              </button>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
