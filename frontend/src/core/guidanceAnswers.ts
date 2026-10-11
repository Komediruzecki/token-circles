/**
 * A profile's guidance answers, read and saved (shared/guidance/answers.ts).
 *
 * The record sits in the profile's settings: under `guidance` in cloud mode, where the settings
 * table is per profile, and under `guidance:<profile id>` in local-first, where one settings row
 * serves the whole browser (shared/profileSettings.ts), as the badge record does
 * (achievementsStore's `recordKey`).
 *
 * Every save goes through `saveAnswers`, which re-reads the record just before it writes and changes
 * only the fields being answered. An answer given meanwhile in another tab, or a field only a newer
 * build knows, is kept. Saves made in this tab run one after another, each on the record the one
 * before it wrote.
 */
import { answersRecord, mergeAnswers, readAnswers } from '../../../shared/guidance/answers'
import { localProfileSettingKey } from '../../../shared/profileSettings'
import { api } from './api'
import { activeProfileId } from './apiProfileScope'
import { getStorageMode } from './storage/storageFactory'
import type { AnswerChanges, Answers, AnswersRecord } from '../../../shared/guidance/answers'

/** Where a profile's answers are stored, in the storage mode in use. */
export function answersKey(profileId: number): string {
  return getStorageMode() === 'serverless'
    ? localProfileSettingKey('guidance', profileId)
    : 'guidance'
}

/**
 * A save for a profile that is no longer the active one, in cloud mode. There the settings are read
 * and written as the active profile (X-Profile-Id), so the save would file one profile's answers as
 * another's. Nothing is written.
 */
export class AnswersProfileChangedError extends Error {
  constructor() {
    super('These answers are for a profile that is no longer open. Open it and answer again.')
    this.name = 'AnswersProfileChangedError'
  }
}

function checkProfile(profileId: number): void {
  if (getStorageMode() !== 'serverless' && activeProfileId() !== profileId) {
    throw new AnswersProfileChangedError()
  }
}

/** A profile's answers in the settings as `GET /api/settings` answers them. */
export function answersIn(settings: Record<string, unknown>, profileId: number): Answers {
  return readAnswers(settings[answersKey(profileId)])
}

async function storedRecord(profileId: number): Promise<AnswersRecord> {
  const settings = (await api.getSettings()) as Record<string, unknown>
  return answersRecord(settings[answersKey(profileId)])
}

/** The answers of a profile, the active one unless named. */
export async function loadAnswers(profileId: number = activeProfileId()): Promise<Answers> {
  checkProfile(profileId)
  return readAnswers(await storedRecord(profileId))
}

/**
 * What a save changes: the fields, or a function that works them out from the record as it was
 * just read, for a change that depends on what is there (setup's `skipped`, which never replaces
 * an answer).
 */
export type AnswersUpdate = AnswerChanges | ((stored: AnswersRecord) => AnswerChanges)

async function save(update: AnswersUpdate, profileId: number): Promise<Answers> {
  const stored = await storedRecord(profileId)
  const record = mergeAnswers(stored, typeof update === 'function' ? update(stored) : update)
  // Checked once the record is read: a switch before or during the read is caught here, before
  // anything is written.
  checkProfile(profileId)
  await api.updateSettings({ [answersKey(profileId)]: JSON.stringify(record) })
  return readAnswers(record)
}

/** The last save this tab started; the next one waits for it. */
let lastSave: Promise<unknown> = Promise.resolve()

/**
 * Answer, change or clear questions for a profile, the active one unless named: re-read its
 * record, set each field in `update` (null clears one, "Ask again"), and store the record.
 * Answers what the profile has answered now, as this build reads it.
 */
export function saveAnswers(
  update: AnswersUpdate,
  profileId: number = activeProfileId()
): Promise<Answers> {
  const next = lastSave.then(() => save(update, profileId))
  lastSave = next.catch(() => undefined)
  return next
}
