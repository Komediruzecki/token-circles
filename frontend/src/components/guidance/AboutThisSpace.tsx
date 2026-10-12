/**
 * Settings, General: About this space. The space questions setup asks, with the active profile's
 * answers chosen and how its region was set (shared/guidance/region.ts). Choosing another answer
 * saves it; "Remove answer" clears one. Every save goes through `saveAnswers`, which re-reads the
 * record first, so an answer given meanwhile in another tab is kept.
 *
 * The region follows what decides it: the answers, the profile's import logs (their bank formats)
 * and the base currency, each re-read when it changes.
 */
import { createSignal, Show } from 'solid-js'
import { mergeAnswers, readAnswers } from '../../../../shared/guidance/answers'
import { chooseRegion } from '../../../../shared/guidance/region'
import { api, getLocalCurrency } from '../../core/api'
import { activeProfileId } from '../../core/apiProfileScope'
import { getProfileVersion } from '../../core/appStore'
import { entityVersion } from '../../core/dataVersions'
import { answersIn, saveAnswers } from '../../core/guidanceAnswers'
import { refetchOnActive } from '../../core/pageVisibility'
import { householdText, regionReasonText } from './regionWords'
import { SpaceQuestions } from './SpaceQuestions'
import styles from './SpaceQuestions.module.css'
import type { AnswerChanges, Answers } from '../../../../shared/guidance/answers'
import type { RegionImport } from '../../../../shared/guidance/region'

const SAVE_FAILED = "Couldn't save your answer. Try again."
const LOAD_FAILED = "Couldn't load your answers. Reload the page to try again."

export function AboutThisSpace() {
  const [answers, setAnswers] = createSignal<Answers>({})
  const [imports, setImports] = createSignal<RegionImport[]>([])
  const [currency, setCurrency] = createSignal<string>(getLocalCurrency())
  const [saving, setSaving] = createSignal(false)
  const [problem, setProblem] = createSignal<string | null>(null)

  const load = async () => {
    const profileId = activeProfileId()
    const [settings, logs] = await Promise.all([api.getSettings(), api.getImportLogs()])
    // Another profile was opened while these loaded: its own load is on the way.
    if (activeProfileId() !== profileId) return
    setAnswers(answersIn(settings as Record<string, unknown>, profileId))
    // The base currency as the app shows it, Settings' Base Currency included.
    setCurrency(getLocalCurrency())
    // The list covers the household view; the region is this profile's.
    setImports(
      (logs as (RegionImport & { profile_id?: unknown })[]).filter(
        (log) => log.profile_id === undefined || Number(log.profile_id) === profileId
      )
    )
  }

  refetchOnActive(
    'settings',
    () => [getProfileVersion(), entityVersion('settings'), entityVersion('import-logs')],
    () => {
      load().catch(() => setProblem(LOAD_FAILED))
    }
  )

  const region = () =>
    chooseRegion({ answer: answers().region, imports: imports(), currency: currency() })

  const save = async (changes: AnswerChanges) => {
    const before = answers()
    setProblem(null)
    setSaving(true)
    setAnswers(readAnswers(mergeAnswers(before, changes)))
    try {
      setAnswers(await saveAnswers(changes))
    } catch {
      setAnswers(before)
      setProblem(SAVE_FAILED)
    } finally {
      setSaving(false)
    }
  }

  const regionNote = () => {
    const status =
      answers().region === 'skipped'
        ? 'You skipped this in setup. '
        : answers().region === undefined
          ? 'Not answered yet. '
          : ''
    return `${status}${regionReasonText(region())}`
  }
  const householdNote = () => householdText(answers().adults, answers().children)

  return (
    <div data-test-id="about-this-space">
      <SpaceQuestions
        idPrefix="settings-space"
        answers={answers()}
        disabled={saving()}
        onChoose={(changes) => void save(changes)}
        regionNote={regionNote()}
        householdNote={householdNote()}
        onAskAgain={(question) =>
          void save(question === 'region' ? { region: null } : { adults: null, children: null })
        }
      />
      <Show when={problem()}>
        <p class={styles.problem} role="alert" data-test-id="about-this-space-problem">
          {problem()}
        </p>
      </Show>
    </div>
  )
}
