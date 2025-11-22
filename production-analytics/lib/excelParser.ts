import * as XLSX from "xlsx";

export interface ExcelParseResult {
  success: boolean;
  data?: Array<Record<string, unknown>>;
  error?: string;
  sheetName?: string;
  rowCount?: number;
  columnCount?: number;
}

/**
 * Reads an Excel file in the browser and converts the first sheet to JSON
 * 
 * @param file - The Excel file (File object from browser)
 * @returns ExcelParseResult with parsed data or error message
 * 
 * @example
 * const result = await parseExcelFile(file);
 * if (result.success) {
 *   console.log(result.data); // Array of objects with column letters as keys
 * }
 */
export async function parseExcelFile(file: File): Promise<ExcelParseResult> {
  try {
    // Validate file type
    if (
      !file.name.toLowerCase().endsWith(".xlsx") &&
      !file.name.toLowerCase().endsWith(".xls")
    ) {
      return {
        success: false,
        error: "File must be an Excel file (.xlsx or .xls)",
      };
    }

    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Parse workbook
    const workbook = XLSX.read(arrayBuffer, {
      type: "array",
      cellDates: true,
      cellNF: false,
      cellText: false,
      sheetStubs: true, // Preserve empty cells
    });

    // Check if workbook has sheets
    if (workbook.SheetNames.length === 0) {
      return {
        success: false,
        error: "Excel file contains no sheets",
      };
    }

    // Get the first sheet
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    if (!worksheet) {
      return {
        success: false,
        error: "Could not read the first sheet",
      };
    }

    // Get sheet dimensions
    const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
    const rowCount = range.e.r + 1; // +1 because range is 0-indexed
    const columnCount = range.e.c + 1;

    // Convert sheet to JSON with column letters as keys
    // Using raw: true to preserve cell values as-is
    // Using defval: null to preserve empty cells
    const jsonData = XLSX.utils.sheet_to_json(worksheet, {
      raw: true, // Preserve raw cell values
      defval: null, // Default value for empty cells (preserves them)
      header: 1, // Use array of arrays format first
    }) as unknown[][];

    // Convert array of arrays to array of objects with column letters as keys
    const dataWithColumnLetters = jsonData.map((row) => {
      const rowObject: Record<string, unknown> = {};
      row.forEach((cell, index) => {
        // Convert column index to letter (0 = A, 1 = B, etc.)
        const columnLetter = XLSX.utils.encode_col(index);
        rowObject[columnLetter] = cell !== undefined ? cell : null;
      });
      return rowObject;
    });

    return {
      success: true,
      data: dataWithColumnLetters,
      sheetName: firstSheetName,
      rowCount,
      columnCount,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to parse Excel file",
    };
  }
}

/**
 * Gets the column letter from a column index (0-based)
 * 
 * @param index - Column index (0 = A, 1 = B, etc.)
 * @returns Column letter (A, B, C, etc.)
 */
export function getColumnLetter(index: number): string {
  return XLSX.utils.encode_col(index);
}

/**
 * Gets the column index from a column letter
 * 
 * @param letter - Column letter (A, B, C, etc.)
 * @returns Column index (0-based)
 */
export function getColumnIndex(letter: string): number {
  return XLSX.utils.decode_col(letter);
}

