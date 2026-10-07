/**
 * The form kit: errors under the field they belong to, a notice for the rest, focus on the first
 * problem. Usage and the rules it keeps: docs/plans/2026-10-07-form-errors.md, and rule 5 in
 * .claude/skills/solid-forms/SKILL.md.
 */
export { createForm } from './createForm'
export type { Form, FormAttributes, FormOptions, FormValues } from './createForm'
export { default as Field } from './Field'
export type { FieldControl, FieldProps } from './Field'
export { default as FormNotice } from './FormNotice'
export { default as SubmitButton, SAVING } from './SubmitButton'
export type { SubmitButtonProps } from './SubmitButton'
