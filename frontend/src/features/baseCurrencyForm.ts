/**
 * Settings' base currency: a select that saves the moment a currency is chosen.
 *
 * It had no label, and whatever went wrong it said the currency was locked, in a toast: a code the
 * runtime refused, a network failure and the lock itself all read "Base currency is locked to EUR
 * after financial data is added." Now the field is labelled, the choice is checked with the rules
 * both runtimes run (shared/settingsSchema.ts), and a refusal is marked under the select in the
 * runtime's words. The lock is the one a person meets: once a profile has accounts or transactions
 * its amounts are kept in the base currency, so the runtimes refuse a new one at the currency, and
 * the select goes back to the currency that stays.
 */
import { fieldErrorsOf } from '../../../shared/refusal'
import { checkSettingsUpdate, readCurrencyCode } from '../../../shared/settingsSchema'
import { createForm } from '../components/form'
import { apiPut, showToast } from '../core/api'
import type { Form } from '../components/form'

export interface BaseCurrencyValues {
  currency: string
}

export type BaseCurrencyForm = Form<BaseCurrencyValues> & {
  /** Save `code` as the base currency, unless it is the one stored. */
  choose: (code: string) => void
}

/** `stored` is the base currency in use; `onChanged` gets the new one once it is saved. */
export function createBaseCurrencyForm(options: {
  stored: () => string
  onChanged: (currency: string) => void
}): BaseCurrencyForm {
  const form: Form<BaseCurrencyValues> = createForm<BaseCurrencyValues, string>({
    initial: { currency: options.stored() },
    check: (values) => fieldErrorsOf(checkSettingsUpdate({ currency: values.currency })),
    send: async (values) => {
      try {
        await apiPut('/api/settings', { currency: values.currency })
      } catch (error) {
        // The select goes back to the currency that stays; the refusal is marked beside it.
        form.set('currency', options.stored())
        throw error
      }
      const code = readCurrencyCode(values.currency) ?? values.currency
      showToast(`Base currency set to ${code}.`, 'success')
      return code
    },
    saved: (code) => {
      options.onChanged(code)
    },
    failure: "Couldn't change the base currency. Try again.",
  })

  const choose = (code: string) => {
    form.set('currency', code)
    if (code !== options.stored()) void form.submit()
  }

  return Object.assign(form, { choose })
}
