/**
 * The account picker when it is the thing that is wrong.
 *
 * A form error rendered only at the top of the page is invisible on a phone: the control that
 * needs fixing is what the user is looking at, and it has to say so itself. This is the half of
 * that which is reusable — the import rows pass `invalid` in, and anything else that has to
 * refuse an empty account can too.
 */
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it } from 'vitest'
import { AccountSelect } from '../AccountSelect'

let host: HTMLDivElement
let dispose: (() => void) | undefined

function mount(opts: { invalid?: boolean; message?: string } = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  dispose = render(
    () => (
      <AccountSelect
        accounts={() => [{ id: 1, name: 'Giro' }]}
        value={() => ''}
        onChange={() => {}}
        invalid={opts.invalid === undefined ? undefined : () => opts.invalid === true}
        invalidMessage={opts.message === undefined ? undefined : () => opts.message as string}
      />
    ),
    host
  )
}

afterEach(() => {
  dispose?.()
  dispose = undefined
  host?.remove()
})

const select = () => host.querySelector<HTMLSelectElement>('[data-test-id="account-select"]')
const message = () => host.querySelector('[data-test-id="account-select-invalid"]')

describe('when nothing is wrong', () => {
  it('says nothing and looks like any other control', () => {
    mount()

    expect(message()).toBeNull()
    expect(select()?.getAttribute('aria-invalid')).toBeNull()
    expect(select()?.className).not.toContain('invalid')
  })
})

describe('when the account is the missing piece', () => {
  it('marks the control and explains itself right there', () => {
    mount({ invalid: true })

    expect(select()?.className).toContain('invalid')
    expect(message()?.textContent).toContain('Choose an account')
  })

  it('is announced to a screen reader, not only coloured', () => {
    mount({ invalid: true })

    // Colour alone is not a message — and `--expense` red is the one colour a colour-blind user is
    // most likely to miss.
    expect(select()?.getAttribute('aria-invalid')).toBe('true')
  })

  it('takes the caller’s wording when the generic one is too vague', () => {
    mount({ invalid: true, message: 'Choose an account for this statement' })

    expect(message()?.textContent).toContain('for this statement')
  })

  it('goes quiet again once it is no longer invalid', () => {
    mount({ invalid: false })

    expect(message()).toBeNull()
    expect(select()?.getAttribute('aria-invalid')).toBeNull()
  })
})
