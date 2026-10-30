/**
 * Settings, General: About this space. The space questions setup asks, with the active profile's
 * answers chosen and how its region was set (shared/guidance/region.ts), and the answers the
 * circles asked for (CircleAnswers). Choosing another answer saves it; "Remove answer" clears one.
 * Every save goes through `saveAnswers`, which re-reads the record first, so an answer given
 * meanwhile in another tab is kept.
 *
 * The production build holds back setup's region and household questions with the benchmarks they
 * choose figures for (core/guidanceGate.ts); the circles' answers show in every build.
 *
 * The region follows what decides it: the answers, the profile's import logs (their bank formats)
 * and the base currency, each re-read when it changes.
 */
import { createSignal, Show } from 'solid-js'
import { mergeAnswers, readAnswers } from '../../../../shared/guidance/answers'
import { SAVE_FAILED } from '../../../../shared/guidance/questions'
import { chooseRegion } from '../../../../shared/guidance/region'
import { api, getLocalCurrency } from '../../core/api'
import { activeProfileId } from '../../core/apiProfileScope'
import { getProfileVersion } from '../../core/appStore'
import { entityVersion } from '../../core/dataVersions'
import { answersIn, saveAnswers } from '../../core/guidanceAnswers'
import { benchmarksShown } from '../../core/guidanceGate'
import { refetchOnActive } from '../../core/pageVisibility'
import { CircleAnswers } from './CircleAnswers'
import { householdText, regionReasonText } from './regionWords'
import { SpaceQuestions } from './SpaceQuestions'
import styles from './SpaceQuestions.module.css'
import type { AnswerChanges, Answers } from '../../../../shared/guidance/answers'
import type { RegionImport } from '../../../../shared/guidance/region'

const LOAD_FAILED = "Couldn't load your answers. Reload the page to try again."

export function AboutThisSpace() {
  const [answers, setAnswers] = createSignal<Answers>({})
  const [imports, setImports] = createSignal<RegionImport[]>([])
  const [currency, setCurrency] = createSignal<string>(getLocalCurrency())
  // Null while the categories could not be read: the support answer then gives a count.
  const [categoryNames, setCategoryNames] = createSignal<ReadonlyMap<number, string> | null>(
    new Map()
  )
  const [saving, setSaving] = createSignal(false)
  const [problem, setProblem] = createSignal<string | null>(null)

  const load = async () => {
    const profileId = activeProfileId()
    const [settings, logs, categories] = await Promise.all([
      api.getSettings(),
      api.getImportLogs(),
      // The answers show without the names: a failed read leaves the support answer a count.
      api.getCategories().catch(() => null),
    ])
    // Another profile was opened while these loaded: its own load is on the way.
    if (activeProfileId() !== profileId) return
    setAnswers(answersIn(settings as Record<string, unknown>, profileId))
    setCategoryNames(
      categories && new Map(categories.map((category) => [category.id, category.name]))
    )
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
    () => [
      getProfileVersion(),
      entityVersion('settings'),
      entityVersion('import-logs'),
      entityVersion('categories'),
    ],
    () => {
      load().catch(() => setProblem(LOAD_FAILED))
    }
  )

  const region = () =>
    chooseRegion({ answer: answers().region, imports: imports(), currency: currency() })

  const save = async (changes: AnswerChanges): Promise<boolean> => {
    const before = answers()
    setProblem(null)
    setSaving(true)
    setAnswers(readAnswers(mergeAnswers(before, changes)))
    try {
      setAnswers(await saveAnswers(changes))
      return true
    } catch {
      setAnswers(before)
      setProblem(SAVE_FAILED)
      return false
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
      <Show when={benchmarksShown()}>
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
      </Show>
      <CircleAnswers
        answers={answers()}
        currency={currency()}
        categoryNames={categoryNames()}
        gate={benchmarksShown()}
        region={region().region}
        disabled={saving()}
        onSave={save}
      />
      <Show when={problem()}>
        <p class={styles.problem} role="alert" data-test-id="about-this-space-problem">
          {problem()}
        </p>
      </Show>
    </div>
  )
}
