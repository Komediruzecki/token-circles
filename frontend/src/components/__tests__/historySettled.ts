/**
 * For a test's afterEach, after it disposes a sign-in screen or dialog: waits until the history
 * traversal that historyStep.ts started is over and no step entry is current.
 *
 * A dialog or step that unmounts on its entry takes the entry back with history.go(), and jsdom
 * lands a traversal two setImmediate tasks later. jsdom's history outlives the test, so without
 * this the next test mounts on the old entry with the traversal still on its way, and its own
 * history.go() (or its sign-in's reload) races that one. A fixed sleep only makes that unlikely.
 *
 * It joins the traversal through afterHistoryStep, so it needs the historyStep module the
 * component used: call it before the next vi.resetModules(), as afterEach does.
 */
export async function historySettled(): Promise<void> {
  const { afterHistoryStep } = await import('../../core/historyStep')
  await new Promise<void>((resolve) => {
    afterHistoryStep(resolve)
  })
  // A landing makes historyStep ignore pops until its next task; let that task run too.
  await new Promise((resolve) => setTimeout(resolve, 0))
}
