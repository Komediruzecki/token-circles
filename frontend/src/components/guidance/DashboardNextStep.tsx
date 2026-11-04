/**
 * Getting started's place on Dashboard (design.md 2.1): Getting started while its record is shown
 * and less than a year is on file, as before; otherwise Your next step, the one step the circles
 * point to, with a way to all seven. Nothing is written when a year arrives, so a year that lapses
 * brings Getting started back.
 *
 * | Getting started record | A year on file | Shows             |
 * | ---------------------- | -------------- | ----------------- |
 * | shown                  | no             | Getting started   |
 * | shown                  | yes            | Your next step    |
 * | hidden                 | either         | Your next step    |
 * | none                   | either         | Your next step    |
 *
 * Once the record is hidden, Your next step leads with the next different step on Getting
 * started's list (review M14): it led with the step the hidden card had just shown.
 *
 * It shows nothing until both the record and the circles are known, so it never shows the one and
 * then swaps it for the other. Your next step names the profile it is for while the Dashboard adds
 * up more than one (`profile`, core/circlesProfile.ts).
 */
import { Match, onMount, Switch } from 'solid-js'
import {
  gettingStartedKnown,
  gettingStartedRecord,
  loadGettingStarted,
} from '../../core/gettingStarted'
import { GettingStartedCard } from '../GettingStarted'
import NextStepCard, { AllCircles } from './NextStepCard'
import type { JSX } from 'solid-js'
import type { GuidanceView } from '../../core/guidance'

export default function DashboardNextStep(props: {
  view: () => GuidanceView | null
  /** The profile the circles are for, named while the Dashboard adds up more than one. */
  profile?: () => string | null
}): JSX.Element {
  onMount(() => {
    void loadGettingStarted()
  })
  const known = () => props.view() !== null && gettingStartedKnown()
  const gettingStarted = () =>
    known() && gettingStartedRecord()?.hidden === false && !props.view()!.facts.firm
  return (
    <Switch>
      <Match when={gettingStarted()}>
        <GettingStartedCard />
      </Match>
      <Match when={known() ? props.view() : null}>
        {(view) => (
          <NextStepCard
            // Hidden, the card led with Getting started's first step: the next different one.
            step={gettingStartedRecord()?.hidden === true ? view().nextOnceHidden : view().next}
            view={view()}
            level={3}
            compact
            profile={props.profile?.()}
            footer={<AllCircles />}
          />
        )}
      </Match>
    </Switch>
  )
}
