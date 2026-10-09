/**
 * The onboarding wizard's two forms, written down once: "Name your space" and "Create your first
 * account". Each checks what it sends by the rules both runtimes run (shared/profileSchema.ts,
 * shared/accountSchema.ts) and says what is wrong under the field, in their words. A refusal
 * from the runtime is marked at the field it names (a profile name another of your profiles has),
 * or said in the form's notice (an account in another currency than the profile's balances).
 *
 * Both used to toast a caught error's own words ("Validation failed", "HTTP 409"), with nothing
 * marked, and a blank name kept the button disabled without saying why. The balance field dropped
 * any letter typed into it, and read "1.234,56" as 1.234.
 */
import {
  ACCOUNT_MESSAGES,
  checkAccountCreate,
  DEFAULT_ACCOUNT_TYPE,
} from '../../../../shared/accountSchema'
import { checkProfileCreate, checkProfileRename } from '../../../../shared/profileSchema'
import { fieldErrorsOf } from '../../../../shared/refusal'
import { apiPost } from '../../core/api'
import { parseDecimalInput } from '../../core/decimalInput'
import { createForm } from '../form'
import type { FieldErrors } from '../../../../shared/refusal'
import type { Form } from '../form'

export interface SpaceValues {
  name: string
  /** The base currency, as the select's value. */
  currency: string
}

export interface SpaceFormOptions {
  /** The profile the wizard names, or null in a workspace with no profile at all. */
  current: () => { id: number; name: string } | null
  /** Stores the space: renames the profile, or creates one; the currency is the wizard's. */
  save: (values: SpaceValues) => Promise<void>
  /** After it is saved: the next step. */
  onSaved: () => void
}

/** "Name your space": the profile's name, checked as a rename of it or as a new profile. */
export function createSpaceForm(options: SpaceFormOptions): Form<SpaceValues> {
  return createForm<SpaceValues>({
    initial: { name: '', currency: 'EUR' },
    check: (values) => {
      const current = options.current()
      return fieldErrorsOf(
        current
          ? checkProfileRename({ name: values.name }, { name: current.name })
          : checkProfileCreate({ name: values.name })
      )
    },
    send: (values) => options.save({ ...values, name: values.name.trim() }),
    saved: () => {
      options.onSaved()
    },
    failure: "Couldn't save your space. Try again.",
  })
}

export interface FirstAccountValues {
  name: string
  type: string
  currency: string
  /** The balance today, as typed: the opening balance. */
  balance: string
  starting_date: string
}

/** What the wizard keeps of an account it created, for the step's chips and the summary. */
export interface CreatedAccount {
  name: string
  type: string
  currency: string
  balance: number
}

export interface FirstAccountFormOptions {
  /** After an account is created: the wizard lists it, and the form starts on the next one. */
  onCreated: (account: CreatedAccount) => void | Promise<void>
}

/** A blank account in `currency`, of the type the wizard offers first. */
export function blankAccount(currency: string): FirstAccountValues {
  return { name: '', type: DEFAULT_ACCOUNT_TYPE, currency, balance: '', starting_date: '' }
}

/**
 * The account the form sends, and what is wrong with a balance it could not read. A blank balance
 * is 0, and the balance is the opening balance too: a new account has no transactions yet.
 */
export function firstAccountBody(values: FirstAccountValues): {
  body: Record<string, unknown>
  fields: FieldErrors
} {
  const balance = values.balance.trim() ? parseDecimalInput(values.balance) : 0
  return {
    body: {
      name: values.name,
      type: values.type,
      currency: values.currency,
      balance: balance ?? undefined,
      starting_balance: balance ?? undefined,
      ...(values.starting_date ? { starting_date: values.starting_date } : {}),
    },
    fields: balance === null ? { balance: ACCOUNT_MESSAGES.balance } : {},
  }
}

/** "Create your first account", which can add another after it. */
export function createFirstAccountForm(options: FirstAccountFormOptions): Form<FirstAccountValues> {
  const form: Form<FirstAccountValues> = createForm<FirstAccountValues, CreatedAccount>({
    initial: blankAccount('EUR'),
    check: (values) => {
      const { body, fields } = firstAccountBody(values)
      return { ...fieldErrorsOf(checkAccountCreate(body)), ...fields }
    },
    send: async (values) => {
      const { body } = firstAccountBody(values)
      await apiPost('/api/accounts', body)
      return {
        name: values.name.trim(),
        type: values.type,
        currency: values.currency,
        balance: body.balance as number,
      }
    },
    saved: (created) => {
      // The next account starts blank, of the same type and currency.
      form.reset({ ...blankAccount(created.currency), type: created.type })
      void options.onCreated(created)
    },
    failure: "Couldn't create the account. Try again.",
  })
  return form
}
