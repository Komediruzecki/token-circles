/**
 * Upload reader: reads a file uploaded on the Import page off the page's thread, so the page
 * stays usable while a large workbook is read (core/storage/handlers/uploadRead.ts). It reads the
 * file as the Worker does (shared/importUpload.ts) and answers what that reader answers.
 */
/* eslint-disable no-restricted-globals */
import * as XLSX from 'xlsx'
import { readUploadedSheet } from '../../../shared/importUpload'
import type { UploadRequest } from '../core/storage/handlers/uploadRead'

self.onmessage = (event: MessageEvent<UploadRequest>) => {
  const { file, requested } = event.data
  self.postMessage(readUploadedSheet(XLSX, file, requested))
}
