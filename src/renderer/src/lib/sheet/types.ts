/**
 * The spreadsheet model the Rust side returns, and the client that fetches it.
 *
 * This mirrors src-tauri/src/spreadsheet.rs field for field. It lives here rather than
 * inline in SheetView.tsx because the window cache and the view both need it, and two
 * copies of a shape that crosses IPC would eventually disagree about a field name.
 */

/** What a cell holds, which decides its alignment and weight. */
export type SheetCellKind = 'number' | 'date' | 'text' | 'bool'

export interface SheetCell {
  /** Zero-based column index within the sheet, not within the returned window. */
  col: number
  /** The text to draw, already formatted by the Rust side. */
  text: string
  kind: SheetCellKind
}

export interface SheetRow {
  /** Zero-based row index within the sheet. */
  row: number
  /** Only the cells that hold something, in column order. */
  cells: SheetCell[]
}

/** A merged block, both ends inclusive and zero-based. */
export interface MergedRegion {
  firstRow: number
  firstCol: number
  lastRow: number
  lastCol: number
}

export interface ColWidth {
  col: number
  width: number
}

export interface SheetData {
  name: string
  /** Total rows in the sheet, not in this window. */
  rowCount: number
  /** Total columns in the sheet, not in this window. */
  colCount: number
  /** First row index included in rows. */
  firstRow: number
  /** First column index drawn; a sheet whose data starts at C3 reports 2. */
  firstCol: number
  rows: SheetRow[]
  merges: MergedRegion[]
  colWidths: ColWidth[]
}

/** How the bytes of a text-format sheet were decoded. */
export type SheetEncoding = 'binary' | 'utf8' | 'gbk'

export interface SpreadsheetModel {
  /** The id the annotations for this file are stored under. */
  deckId: string
  /** Every sheet name, in workbook order. */
  sheets: string[]
  /** The sheet whose rows are included. */
  active: string
  /** Zero-based index of active within sheets. */
  activeIndex: number
  sheet: SheetData
  encoding: SheetEncoding
  /** True when the window is not the whole sheet. */
  truncated: boolean
}

/** The slice of a sheet a caller asks for. */
export interface SheetRequest {
  /** Sheet name; omit for the workbook's first sheet. */
  sheet?: string
  /** First row, zero based. */
  firstRow?: number
  /** How many rows; omit for the server default. */
  rowCount?: number
}

/** The one host call a sheet needs. */
export interface SheetSource {
  openSpreadsheet(path: string, request?: SheetRequest): Promise<SpreadsheetModel>
}
