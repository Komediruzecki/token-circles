/**
 * Spreadsheet Service — wraps xlsx/SheetJS for import parsing.
 */

let _XLSX = null

function getXLSX() {
  if (!_XLSX) {
    _XLSX = require('xlsx')
  }
  return _XLSX
}

function readFile(filepath) {
  const XLSX = getXLSX()
  const workbook = XLSX.readFile(filepath)
  return {
    sheetNames: workbook.SheetNames,
    sheets: workbook.Sheets,
    workbook,
  }
}

function readBuffer(buf) {
  const XLSX = getXLSX()
  const workbook = XLSX.read(buf, { type: 'array' })
  return {
    sheetNames: workbook.SheetNames,
    sheets: workbook.Sheets,
    workbook,
  }
}

function sheetToJson(sheet, options) {
  const XLSX = getXLSX()
  return XLSX.utils.sheet_to_json(sheet, options)
}

function parseExcelDate(dateStr) {
  const XLSX = getXLSX()
  return XLSX.SSF.parse_date_code(dateStr)
}

module.exports = { readFile, readBuffer, sheetToJson, parseExcelDate }
