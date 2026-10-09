/**
 * The Import page's File Upload, on the form kit: the file, read as soon as it is chosen or
 * dropped.
 *
 * A file that was not read was said in the banner at the top of the page, away from the drop area
 * it was about, and a file over the size cap went up before either runtime refused it. Now the
 * size is checked before anything is sent, with the rule both runtimes run
 * (shared/importUpload.ts), and a file either one refuses (one with no sheets, or one that cannot
 * be read) is marked under the drop area, in the runtime's words.
 */
import { uploadRefusal } from '../../../../shared/importUpload'
import { createForm } from '../../components/form'
import type { Form } from '../../components/form'
import type { ImportFlow } from './importFlow'

export interface UploadValues {
  file: File | null
}

export type UploadForm = Form<UploadValues> & {
  /** Reads `file`: the input's change and a drop both call this. */
  pick: (file: File | undefined) => void
}

/** The upload field for `flow`, which reads the file and goes on to the mapping step. */
export function createUploadForm(flow: ImportFlow): UploadForm {
  const form = createForm<UploadValues>({
    initial: { file: null },
    check: (values) => uploadRefusal(values.file)?.fields ?? {},
    send: async (values) => {
      if (values.file) await flow.uploadFile(values.file)
    },
    failure: "Couldn't read that file. Try again, or upload it as a CSV file.",
  })
  const pick = (file: File | undefined) => {
    if (!file) return
    form.set('file', file)
    void form.submit()
  }
  return Object.assign(form, { pick })
}
