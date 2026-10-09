/**
 * The settings that belong to one profile: its retirement plan and its badge record.
 *
 * The Worker's settings table is keyed by (key, profile_id), so there each is a row of its
 * profile under the plain key. Local-first keeps one settings row per key for the whole browser,
 * so it names the profile in the key: `retirement_settings:<profile id>`. A backup moved from one
 * runtime to the other is read through these, so that each setting stays with its profile.
 */
export const PROFILE_SETTING_KEYS = ['retirement_settings', 'achievements'] as const;

export type ProfileSettingKey = (typeof PROFILE_SETTING_KEYS)[number];

/** Whether `key` is one of these in the Worker's form: the plain key. */
export function isProfileSettingKey(key: string): key is ProfileSettingKey {
  return (PROFILE_SETTING_KEYS as readonly string[]).includes(key);
}

/** Local-first's key for `key` of profile `profileId`. */
export function localProfileSettingKey(key: ProfileSettingKey, profileId: number): string {
  return `${key}:${profileId}`;
}

/** A key in local-first's form split into the plain key and its profile, or null for any other. */
export function splitLocalProfileSettingKey(
  key: string
): { key: ProfileSettingKey; profileId: number } | null {
  const match = /^(retirement_settings|achievements):(\d+)$/.exec(key);
  return match ? { key: match[1] as ProfileSettingKey, profileId: Number(match[2]) } : null;
}

/** Whether `key` is one of these in either form. */
export function belongsToOneProfile(key: string): boolean {
  return isProfileSettingKey(key) || splitLocalProfileSettingKey(key) !== null;
}
