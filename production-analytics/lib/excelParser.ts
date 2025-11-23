import * as XLSX from "xlsx";
import { validateFileName } from "./fileValidation";
import { calculateRunSpeed } from "./calculations";

export interface ExcelParseResult {
  success: boolean;
  data?: Array<Record<string, unknown>>;
  error?: string;
  sheetName?: string;
  rowCount?: number;
  columnCount?: number;
}

export interface ShiftSummary {
  start_time: string | null;
  end_time: string | null;
  shift: string | null;
  team: string | null;
  actual_hours: number | null;
  make_ready_time: number | null;
  downtime: number | null;
}

export interface WorkOrderTimeRange {
  start_time: string | null;
  end_time: string | null;
}

export interface WorkOrder {
  work_order_number: number | null;
  good_production: number | null;
  lhe: number | null;
  spoilage_percent: number | null;
  make_ready: WorkOrderTimeRange;
  production: WorkOrderTimeRange;
}

export interface WorkOrderWithDetails extends WorkOrder {
  downtime: DowntimeEvent[];
  spoilage: SpoilageEvent[];
  shift: ShiftSummary | null;
  run_speed: number;
}

export interface ProductionReport {
  press: string;
  date: string; // DD-MM-YYYY format
  shifts: ShiftSummary[];
  workOrders: WorkOrderWithDetails[];
}

export interface DowntimeEvent {
  category: string;
  minutes: number;
}

export interface SpoilageEvent {
  category: string;
  units: number;
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
 * Parses the shift summary table from Excel data
 * Finds the table starting around row 3 and extracts shift information
 * 
 * @param excelData - Array of row objects with column letters as keys (from parseExcelFile)
 * @returns Array of ShiftSummary objects
 * 
 * @example
 * const result = await parseExcelFile(file);
 * if (result.success && result.data) {
 *   const shifts = parseShiftSummary(result.data);
 *   console.log(shifts);
 * }
 */
export function parseShiftSummary(
  excelData: Array<Record<string, unknown>>
): ShiftSummary[] {
  if (!excelData || excelData.length === 0) {
    return [];
  }

  // Expected headers (flexible matching to handle variations)
  const expectedHeaders = [
    "Start",
    "End",
    "Shift",
    "Team",
    "Actual Line Hours",
    "Make Ready", // Can also match "Make Ready Time"
    "Other Logged", // Can also match "Other Logged Down Time"
  ];

  // Find the header row (starting from row 3, which is index 2)
  let headerRowIndex = -1;
  const searchStartRow = Math.min(2, excelData.length - 1); // Start at row 3 (index 2)

  for (let i = searchStartRow; i < Math.min(searchStartRow + 10, excelData.length); i++) {
    const row = excelData[i];
    const rowValues = Object.values(row)
      .map((val) => (val !== null && val !== undefined ? String(val).trim() : ""))
      .filter((val) => val.length > 0);

    // Check if this row contains the expected headers
    const foundHeaders = expectedHeaders.filter((header) =>
      rowValues.some((val) => val.toLowerCase().includes(header.toLowerCase()))
    );

    // If we found at least 4 of the expected headers, consider this the header row
    if (foundHeaders.length >= 4) {
      headerRowIndex = i;
      break;
    }
  }

  if (headerRowIndex === -1) {
    // No header row found
    return [];
  }

  const headerRow = excelData[headerRowIndex];
  const headerRowValues = Object.entries(headerRow).map(([col, val]) => ({
    col,
    val: val !== null && val !== undefined ? String(val).trim() : "",
  }));

  // Map column letters to field names
  const columnMap: Record<string, keyof ShiftSummary> = {};

  expectedHeaders.forEach((header) => {
    const headerLower = header.toLowerCase();
    const column = headerRowValues.find((cell) =>
      cell.val.toLowerCase().includes(headerLower)
    );

    if (column) {
      // Map header to field name
      switch (header) {
        case "Start":
          columnMap[column.col] = "start_time";
          break;
        case "End":
          columnMap[column.col] = "end_time";
          break;
        case "Shift":
          columnMap[column.col] = "shift";
          break;
        case "Team":
          columnMap[column.col] = "team";
          break;
        case "Actual Line Hours":
          columnMap[column.col] = "actual_hours";
          break;
        case "Make Ready":
          // Also matches "Make Ready Time"
          columnMap[column.col] = "make_ready_time";
          break;
        case "Other Logged":
          // Also matches "Other Logged Down Time"
          columnMap[column.col] = "downtime";
          break;
      }
    }
  });

  // Extract shift rows (starting after the header row)
  // Stop when we encounter work order data (numeric value in column A or "Works Order" header)
  const shifts: ShiftSummary[] = [];
  const dataStartRow = headerRowIndex + 1;

  for (let i = dataStartRow; i < excelData.length; i++) {
    const row = excelData[i];

    // Check if we've hit the work orders section
    // Look for "Works Order" header or numeric value in column A (work order number)
    const colA = row["A"];
    if (colA !== null && colA !== undefined) {
      const colAStr = String(colA).trim().toLowerCase();
      // If column A contains "works order" or is a numeric value, we've hit work order data
      if (colAStr.includes("works order") || colAStr.includes("work order") || /^\d+$/.test(colAStr)) {
        // Stop parsing shifts - we've reached the work orders section
        break;
      }
    }

    // Check if this is an empty row
    const rowValues = Object.values(row).filter(
      (val) => val !== null && val !== undefined && String(val).trim() !== ""
    );

    if (rowValues.length === 0) {
      // Empty row, skip it
      continue;
    }

    // Extract shift data
    const shift: ShiftSummary = {
      start_time: null,
      end_time: null,
      shift: null,
      team: null,
      actual_hours: null,
      make_ready_time: null,
      downtime: null,
    };

    // Map values from columns
    let isWorkOrderData = false;
    for (const [col, field] of Object.entries(columnMap)) {
      const value = row[col];

      if (value !== null && value !== undefined) {
        if (field === "actual_hours" || field === "make_ready_time" || field === "downtime") {
          // Numeric fields
          const numValue = typeof value === "number" ? value : parseFloat(String(value));
          if (!isNaN(numValue)) {
            shift[field] = numValue;
          }
        } else {
          // String fields - especially important for team extraction
          let strValue = String(value).trim();
          
          // For team field, ensure we extract just the team letter (A, B, C)
          // Handle cases where it might be "Team A", "Shift A", "A", "C", etc.
          if (field === "team") {
            // Remove "Team" or "Shift" prefix if present and extract just the letter
            strValue = strValue.replace(/^(team|shift)\s*/i, "").trim();
            // Extract the last letter if it's A, B, or C (handles "Shift A", "Shift B", etc.)
            const lastChar = strValue.charAt(strValue.length - 1).toUpperCase();
            if (["A", "B", "C"].includes(lastChar)) {
              strValue = lastChar;
            } else if (strValue.length > 0 && /^[A-Za-z]/.test(strValue)) {
              // If not A/B/C at the end, take first character
              strValue = strValue.charAt(0).toUpperCase();
            }
            // Validate team is A, B, or C - if not, log warning but keep value
            if (!["A", "B", "C"].includes(strValue)) {
              console.warn(`Unexpected team value: "${strValue}". Expected A, B, or C. Row:`, row);
            }
          }
          
          // For shift field, validate it's a valid shift name
          if (field === "shift") {
            const validShifts = ["Earlies", "Lates", "Nights"];
            if (!validShifts.some(vs => strValue.toLowerCase().includes(vs.toLowerCase()))) {
              // If this doesn't look like a shift name, it might be work order data
              isWorkOrderData = true;
              break; // Exit the for loop
            }
          }
          
          if (strValue.length > 0) {
            shift[field] = strValue;
          }
        }
      }
    }
    
    // If we detected work order data, stop parsing shifts
    if (isWorkOrderData) {
      break;
    }
    
    // Debug logging for team extraction
    if (shift.shift && shift.team) {
      console.log(`Extracted shift: ${shift.shift}, team: ${shift.team}, start: ${shift.start_time}, end: ${shift.end_time}`);
    } else if (shift.shift && !shift.team) {
      console.warn(`Shift ${shift.shift} found but team is missing. Row data:`, row);
    }

    // Filter out invalid shifts (like "Daily Total" row)
    // A valid shift must have a shift name (Earlies, Lates, Nights) and team
    const isValidShift = shift.shift && 
                        ["Earlies", "Lates", "Nights"].some(vs => 
                          shift.shift?.toLowerCase().includes(vs.toLowerCase())
                        ) &&
                        shift.team &&
                        ["A", "B", "C"].includes(shift.team);

    if (isValidShift) {
      // Convert Date objects to HH:MM format for start_time and end_time
      // Use type assertion because Excel might return Date objects even though interface says string
      const startTime = shift.start_time as string | Date | null;
      const endTime = shift.end_time as string | Date | null;
      
      if (startTime instanceof Date) {
        const hours = startTime.getHours().toString().padStart(2, "0");
        const minutes = startTime.getMinutes().toString().padStart(2, "0");
        shift.start_time = `${hours}:${minutes}`;
      } else if (startTime && typeof startTime === "string") {
        // Remove seconds if present and extract just HH:MM
        const timeStr = String(startTime);
        // Handle full date strings like "Fri Nov 14 2025 06:00:00 GMT+0000"
        const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
          shift.start_time = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
        } else if (timeStr.includes(":") && timeStr.split(":").length === 3) {
          shift.start_time = timeStr.split(":").slice(0, 2).join(":");
        }
      }

      if (endTime instanceof Date) {
        const hours = endTime.getHours().toString().padStart(2, "0");
        const minutes = endTime.getMinutes().toString().padStart(2, "0");
        shift.end_time = `${hours}:${minutes}`;
      } else if (endTime && typeof endTime === "string") {
        // Remove seconds if present and extract just HH:MM
        const timeStr = String(endTime);
        // Handle full date strings like "Fri Nov 14 2025 13:00:00 GMT+0000"
        const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
          shift.end_time = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
        } else if (timeStr.includes(":") && timeStr.split(":").length === 3) {
          shift.end_time = timeStr.split(":").slice(0, 2).join(":");
        }
      }

      shifts.push(shift);
      console.log(`Added valid shift: ${shift.shift}, team: ${shift.team}, ${shift.start_time}-${shift.end_time}`);
    } else {
      console.warn(`Skipped invalid shift row:`, shift);
    }
  }

  return shifts;
}

/**
 * Parses work orders from Excel data
 * Scans for rows where column A contains a numeric work order number
 * Extracts work order details and associated time ranges
 * 
 * @param excelData - Array of row objects with column letters as keys (from parseExcelFile)
 * @returns Array of WorkOrder objects
 * 
 * @example
 * const result = await parseExcelFile(file);
 * if (result.success && result.data) {
 *   const workOrders = parseWorkOrders(result.data);
 *   console.log(workOrders);
 * }
 */
export function parseWorkOrders(
  excelData: Array<Record<string, unknown>>
): WorkOrder[] {
  if (!excelData || excelData.length === 0) {
    return [];
  }

  const workOrders: WorkOrder[] = [];
  let currentWorkOrder: Partial<WorkOrder> | null = null;
  let currentWorkOrderStartRow = -1;

  for (let i = 0; i < excelData.length; i++) {
    const row = excelData[i];
    const colA = row["A"]; // Works Order column
    const colB = row["B"]; // Good Production
    const colC = row["C"]; // LHE
    const colD = row["D"]; // Spoilage %

    // Check if column A has a numeric value (work order number)
    const workOrderNumber = parseNumericValue(colA);

    if (workOrderNumber !== null) {
      // Save previous work order if exists (including blank work orders)
      if (currentWorkOrder && currentWorkOrderStartRow >= 0) {
        workOrders.push(completeWorkOrder(currentWorkOrder));
      }

      // Start new work order (including work order 0 - blank entries)
      // Note: We allow duplicate work order numbers because the same work order
      // can appear in different shifts/teams and should be tracked separately
      // Work order 0 (blank) is allowed and will be saved as a separate entry
      currentWorkOrder = {
        work_order_number: workOrderNumber,
        good_production: parseNumericValue(colB),
        lhe: parseNumericValue(colC),
        spoilage_percent: parseNumericValue(colD),
        make_ready: { start_time: null, end_time: null },
        production: { start_time: null, end_time: null },
      };
      currentWorkOrderStartRow = i;
      if (workOrderNumber === 0) {
        console.log(`Found blank work order (0) at row ${i + 1} - will be saved as separate entry`);
      } else {
        console.log(`Found work order ${workOrderNumber} at row ${i + 1}`);
      }
      
      // Check if this row also has "Make Ready" in column F (same row as work order number)
      const colF = row["F"];
      const colFValue = colF !== null && colF !== undefined ? String(colF).trim().toLowerCase() : "";
      if (colFValue.includes("make ready")) {
        const timeRange = extractTimeRange(row);
        console.log(`Make Ready times for WO ${workOrderNumber} (same row as WO number):`, {
          start: timeRange.start_time,
          end: timeRange.end_time,
          rowG: row["G"],
          rowH: row["H"],
          colF: colF
        });
        if (currentWorkOrder.make_ready) {
          currentWorkOrder.make_ready.start_time = timeRange.start_time;
          currentWorkOrder.make_ready.end_time = timeRange.end_time;
        }
      }
    } else if (currentWorkOrder && currentWorkOrderStartRow >= 0) {
      // We're in a work order section, look for Make Ready and Production rows
      // Column F contains both "Make Ready" and "Production" text
      // Times are always in columns G (Start) and H (End)
      
      const colF = row["F"];
      const colFValue = colF !== null && colF !== undefined ? String(colF).trim().toLowerCase() : "";
      
      // Check column F for "Production" or "Make Ready"
      // Use includes() to be more flexible with spacing/casing
      if (colFValue.includes("production")) {
        // Found Production row - extract times from columns G and H
        const timeRange = extractTimeRange(row);
        console.log(`Production times for WO ${currentWorkOrder.work_order_number}:`, {
          start: timeRange.start_time,
          end: timeRange.end_time,
          rowG: row["G"],
          rowH: row["H"],
          colF: colF
        });
        if (currentWorkOrder.production) {
          currentWorkOrder.production.start_time = timeRange.start_time;
          currentWorkOrder.production.end_time = timeRange.end_time;
        }
      } else if (colFValue.includes("make ready")) {
        // Found Make Ready row - extract times from columns G and H
        const timeRange = extractTimeRange(row);
        console.log(`Make Ready times for WO ${currentWorkOrder.work_order_number}:`, {
          start: timeRange.start_time,
          end: timeRange.end_time,
          rowG: row["G"],
          rowH: row["H"],
          colF: colF
        });
        if (currentWorkOrder.make_ready) {
          currentWorkOrder.make_ready.start_time = timeRange.start_time;
          currentWorkOrder.make_ready.end_time = timeRange.end_time;
        }
      } else if (colFValue.length > 0) {
        // Log any other non-empty values in column F to help debug
        console.log(`Row ${i + 1} has non-empty value in column F but not recognized: "${colF}" (normalized: "${colFValue}")`);
      }

      // Continue processing rows until we find the next work order
      // Empty rows are handled by checking for the next numeric value in column A
    }
  }

  // Don't forget the last work order
  if (currentWorkOrder && currentWorkOrderStartRow >= 0) {
    workOrders.push(completeWorkOrder(currentWorkOrder));
  }

  return workOrders;
}

/**
 * Helper function to parse a numeric value from a cell
 * 
 * @param value - Cell value
 * @returns Parsed number or null if not numeric
 */
function parseNumericValue(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return isNaN(value) ? null : value;
  }

  const strValue = String(value).trim();
  if (strValue === "" || strValue === "-") {
    return null;
  }

  // Remove percentage signs and other formatting
  const cleaned = strValue.replace(/%/g, "").trim();
  const numValue = parseFloat(cleaned);

  return isNaN(numValue) ? null : numValue;
}

/**
 * Helper function to extract start and end times from a row
 * Typically times are in columns that come after column F
 * We'll look for time-like values in common columns (G, H, I, J, etc.)
 * 
 * @param row - Row object with column letters as keys
 * @returns TimeRange with start and end times
 */
function extractTimeRange(row: Record<string, unknown>): WorkOrderTimeRange {
  const timeRange: WorkOrderTimeRange = {
    start_time: null,
    end_time: null,
  };

  // Based on the Excel layout, times are typically in columns G (Start) and H (End)
  // Look for time values (format: HH:MM or HH:MM:SS)
  const timePattern = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

  // Helper function to extract time from a value (handles strings, dates, and Excel serial numbers)
  const extractTime = (value: unknown): string | null => {
    if (value === null || value === undefined) {
      return null;
    }

    // If it's a Date object, format it as HH:MM
    if (value instanceof Date) {
      const hours = value.getHours().toString().padStart(2, "0");
      const minutes = value.getMinutes().toString().padStart(2, "0");
      return `${hours}:${minutes}`;
    }

    // If it's a number (Excel serial time), convert it
    if (typeof value === "number") {
      // Excel stores times as fractions of a day (0.0 = midnight, 0.5 = noon)
      // If the number is less than 1, it's likely a time
      if (value >= 0 && value < 1) {
        const totalMinutes = Math.floor(value * 24 * 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
      }
    }

    // Try as string
    const strValue = String(value).trim();
    
    // Check if it matches time pattern
    if (timePattern.test(strValue)) {
      return strValue;
    }

    return null;
  };

  // Always get Start from column G and End from column H (per user requirements)
  const startValue = row["G"];
  const endValue = row["H"];

  timeRange.start_time = extractTime(startValue);
  timeRange.end_time = extractTime(endValue);

  return timeRange;
}

/**
 * Helper function to complete a work order object with default values
 * 
 * @param workOrder - Partial work order object
 * @returns Complete WorkOrder object
 */
function completeWorkOrder(workOrder: Partial<WorkOrder>): WorkOrder {
  return {
    work_order_number: workOrder.work_order_number ?? null,
    good_production: workOrder.good_production ?? null,
    lhe: workOrder.lhe ?? null,
    spoilage_percent: workOrder.spoilage_percent ?? null,
    make_ready: workOrder.make_ready ?? { start_time: null, end_time: null },
    production: workOrder.production ?? { start_time: null, end_time: null },
  };
}

/**
 * Parses downtime events from rows after a work order's production row
 * Looks for rows where column O (Comments) has text and column P (Mins) has a number
 * 
 * @param excelData - Array of row objects with column letters as keys (from parseExcelFile)
 * @param productionRowIndex - Index of the production row (after this row, downtime events are found)
 * @returns Array of DowntimeEvent objects
 * 
 * @example
 * const result = await parseExcelFile(file);
 * if (result.success && result.data) {
 *   const workOrders = parseWorkOrders(result.data);
 *   // For each work order, find its production row and parse downtime events
 *   const downtimeEvents = parseDowntimeEvents(result.data, productionRowIndex);
 * }
 */
export function parseDowntimeEvents(
  excelData: Array<Record<string, unknown>>,
  productionRowIndex: number
): DowntimeEvent[] {
  if (!excelData || excelData.length === 0 || productionRowIndex < 0) {
    return [];
  }

  const downtimeEvents: DowntimeEvent[] = [];
  const startRow = productionRowIndex + 1; // Start after the production row

  // Scan forward until we find the next work order (numeric value in column A) or end of data
  for (let i = startRow; i < excelData.length; i++) {
    const row = excelData[i];

    // Check if we've reached the next work order (numeric value in column A)
    const colA = row["A"];
    const workOrderNumber = parseNumericValue(colA);
    if (workOrderNumber !== null) {
      // Found next work order, stop processing
      break;
    }

    // Check if this row has downtime event data
    const colO = row["O"]; // Comments column
    const colP = row["P"]; // Mins column
    const colQ = row["Q"]; // Units column

    // Filter out rows where both Mins (P) and Units (Q) are empty
    const minsValue = parseNumericValue(colP);
    const unitsValue = parseNumericValue(colQ);

    if (minsValue === null && unitsValue === null) {
      // Both Mins and Units are empty, skip this row
      continue;
    }

    // Check if Comments (column O) has text and Mins (column P) has a number
    const commentsText =
      colO !== null && colO !== undefined ? String(colO).trim() : "";

    if (commentsText.length > 0 && minsValue !== null) {
      // Valid downtime event
      downtimeEvents.push({
        category: commentsText,
        minutes: minsValue,
      });
      console.log(`Found downtime event at row ${i + 1}: ${commentsText} - ${minsValue} min`);
    } else if (commentsText.length > 0 && minsValue === null) {
      // Log rows with comments but no minutes (might be spoilage or other data)
      console.log(`Row ${i + 1} has comment "${commentsText}" but no minutes value`);
    }
  }

  return downtimeEvents;
}

/**
 * Parses spoilage events from rows after a work order's production row
 * Looks for rows where column O (Comments) has text and column Q (Units) has a number
 * 
 * @param excelData - Array of row objects with column letters as keys (from parseExcelFile)
 * @param productionRowIndex - Index of the production row (after this row, spoilage events are found)
 * @returns Array of SpoilageEvent objects
 * 
 * @example
 * const result = await parseExcelFile(file);
 * if (result.success && result.data) {
 *   const workOrders = parseWorkOrders(result.data);
 *   // For each work order, find its production row and parse spoilage events
 *   const spoilageEvents = parseSpoilageEvents(result.data, productionRowIndex);
 * }
 */
export function parseSpoilageEvents(
  excelData: Array<Record<string, unknown>>,
  productionRowIndex: number
): SpoilageEvent[] {
  if (!excelData || excelData.length === 0 || productionRowIndex < 0) {
    return [];
  }

  const spoilageEvents: SpoilageEvent[] = [];
  const startRow = productionRowIndex + 1; // Start after the production row

  // Scan forward until we find the next work order (numeric value in column A) or end of data
  for (let i = startRow; i < excelData.length; i++) {
    const row = excelData[i];

    // Check if we've reached the next work order (numeric value in column A)
    const colA = row["A"];
    const workOrderNumber = parseNumericValue(colA);
    if (workOrderNumber !== null) {
      // Found next work order, stop processing
      break;
    }

    // Check if this row has spoilage event data
    const colO = row["O"]; // Comments column
    const colQ = row["Q"]; // Units column

    // Check if Comments (column O) has text and Units (column Q) has a number
    const commentsText =
      colO !== null && colO !== undefined ? String(colO).trim() : "";
    const unitsValue = parseNumericValue(colQ);

    if (commentsText.length > 0 && unitsValue !== null) {
      // Valid spoilage event
      spoilageEvents.push({
        category: commentsText,
        units: unitsValue,
      });
      console.log(`Found spoilage event at row ${i + 1}: ${commentsText} - ${unitsValue} units`);
    } else if (commentsText.length > 0 && unitsValue === null) {
      // Log rows with comments but no units (might be downtime or other data)
      console.log(`Row ${i + 1} has comment "${commentsText}" but no units value`);
    }
  }

  return spoilageEvents;
}

/**
 * Assigns a work order to a shift based on time overlap
 * Determines which shift the work order belongs to by calculating time overlap
 * Handles edge cases where work orders span multiple shifts (assigns to shift with most overlap)
 * 
 * @param workOrderStart - Work order start time (HH:MM format, e.g., "06:00")
 * @param workOrderEnd - Work order end time (HH:MM format, e.g., "14:00")
 * @param shifts - Array of ShiftSummary objects with start_time and end_time
 * @returns The matching ShiftSummary object with the most overlap, or null if no overlap
 * 
 * @example
 * const shifts = parseShiftSummary(excelData);
 * const shift = assignWorkOrderToShift("06:00", "14:00", shifts);
 */
export function assignWorkOrderToShift(
  workOrderStart: string | null,
  workOrderEnd: string | null,
  shifts: ShiftSummary[]
): ShiftSummary | null {
  if (!workOrderStart || !workOrderEnd || !shifts || shifts.length === 0) {
    return null;
  }

  // Normalize work order times (remove seconds if present)
  let normalizedStart = workOrderStart;
  let normalizedEnd = workOrderEnd;
  
  if (normalizedStart.includes(":") && normalizedStart.split(":").length === 3) {
    normalizedStart = normalizedStart.split(":").slice(0, 2).join(":");
  }
  if (normalizedEnd.includes(":") && normalizedEnd.split(":").length === 3) {
    normalizedEnd = normalizedEnd.split(":").slice(0, 2).join(":");
  }

  // Convert times to minutes for easier comparison
  const workOrderStartMinutes = timeToMinutes(normalizedStart);
  const workOrderEndMinutes = timeToMinutes(normalizedEnd);

  if (workOrderStartMinutes === null || workOrderEndMinutes === null) {
    console.warn("assignWorkOrderToShift: Failed to parse work order times", {
      normalizedStart,
      normalizedEnd,
      originalStart: workOrderStart,
      originalEnd: workOrderEnd,
    });
    return null;
  }

  let bestShift: ShiftSummary | null = null;
  let maxOverlap = 0;

  for (const shift of shifts) {
    if (!shift.start_time || !shift.end_time) {
      console.warn("assignWorkOrderToShift: Shift missing times", shift);
      continue;
    }

    // Shift times should already be normalized to "HH:MM" format from parseShiftSummary
    // Extract time from string (handles both "HH:MM" and full date strings like "Fri Nov 14 2025 06:00:00 GMT+0000")
    const extractTimeFromString = (timeStr: string | Date | null): string => {
      if (!timeStr) return "";
      
      if (timeStr instanceof Date) {
        return `${timeStr.getHours().toString().padStart(2, "0")}:${timeStr.getMinutes().toString().padStart(2, "0")}`;
      }
      
      const str = String(timeStr);
      // Try to match HH:MM pattern (handles "06:00", "Fri Nov 14 2025 06:00:00 GMT+0000", etc.)
      const timeMatch = str.match(/(\d{1,2}):(\d{2})/);
      if (timeMatch) {
        return `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
      }
      return str;
    };

    const shiftStartStr = extractTimeFromString(shift.start_time);
    const shiftEndStr = extractTimeFromString(shift.end_time);

    const shiftStartMinutes = timeToMinutes(shiftStartStr);
    const shiftEndMinutes = timeToMinutes(shiftEndStr);

    if (shiftStartMinutes === null || shiftEndMinutes === null) {
      console.warn("assignWorkOrderToShift: Failed to parse shift times", {
        shift: shift.shift,
        start_time: shiftStartStr,
        end_time: shiftEndStr,
      });
      continue;
    }

    // Calculate overlap
    const overlap = calculateTimeOverlap(
      workOrderStartMinutes,
      workOrderEndMinutes,
      shiftStartMinutes,
      shiftEndMinutes
    );

    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      bestShift = shift;
    }
  }

  return bestShift;
}

/**
 * Converts time string (HH:MM) to minutes since midnight
 * 
 * @param timeStr - Time string in HH:MM format (e.g., "06:00", "14:30")
 * @returns Minutes since midnight, or null if invalid
 */
function timeToMinutes(timeStr: string): number | null {
  // Handle both "HH:MM" and "HH:MM:SS" formats
  const timePattern = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
  const match = timeStr.match(timePattern);

  if (!match) {
    return null;
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

/**
 * Calculates the overlap in minutes between two time ranges
 * Handles ranges that cross midnight (e.g., 22:00 to 06:00)
 * 
 * @param start1 - Start time of first range in minutes
 * @param end1 - End time of first range in minutes
 * @param start2 - Start time of second range in minutes
 * @param end2 - End time of second range in minutes
 * @returns Overlap in minutes, or 0 if no overlap
 */
function calculateTimeOverlap(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): number {
  // Handle ranges that cross midnight
  const range1CrossesMidnight = start1 > end1;
  const range2CrossesMidnight = start2 > end2;

  // Normalize ranges that cross midnight by splitting them
  if (range1CrossesMidnight && range2CrossesMidnight) {
    // Both cross midnight: compare both parts
    const overlap1 = calculateOverlap(start1, 1440, start2, 1440); // Both start parts
    const overlap2 = calculateOverlap(0, end1, 0, end2); // Both end parts
    return overlap1 + overlap2;
  } else if (range1CrossesMidnight) {
    // Range 1 crosses midnight, range 2 doesn't
    const overlap1 = calculateOverlap(start1, 1440, start2, end2); // Start part of range 1
    const overlap2 = calculateOverlap(0, end1, start2, end2); // End part of range 1
    return Math.max(overlap1, overlap2);
  } else if (range2CrossesMidnight) {
    // Range 2 crosses midnight, range 1 doesn't
    const overlap1 = calculateOverlap(start1, end1, start2, 1440); // Start part of range 2
    const overlap2 = calculateOverlap(start1, end1, 0, end2); // End part of range 2
    return Math.max(overlap1, overlap2);
  } else {
    // Neither crosses midnight: simple overlap calculation
    return calculateOverlap(start1, end1, start2, end2);
  }
}

/**
 * Calculates overlap between two time ranges that don't cross midnight
 * 
 * @param start1 - Start time of first range in minutes
 * @param end1 - End time of first range in minutes
 * @param start2 - Start time of second range in minutes
 * @param end2 - End time of second range in minutes
 * @returns Overlap in minutes, or 0 if no overlap
 */
function calculateOverlap(
  start1: number,
  end1: number,
  start2: number,
  end2: number
): number {
  const overlapStart = Math.max(start1, start2);
  const overlapEnd = Math.min(end1, end2);

  if (overlapStart >= overlapEnd) {
    return 0; // No overlap
  }

  return overlapEnd - overlapStart;
}

/**
 * Finds production row indices for work orders in Excel data
 * 
 * @param excelData - Array of row objects with column letters as keys
 * @param workOrders - Array of work orders to find production rows for
 * @returns Map of work order number to production row index
 */
/**
 * Finds production row indices for work orders, matching them in order to handle duplicates
 * 
 * @param excelData - Array of row objects with column letters as keys
 * @param workOrders - Array of work orders to find production rows for
 * @returns Array of production row indices, one for each work order in the same order
 */
function findProductionRowIndicesForWorkOrders(
  excelData: Array<Record<string, unknown>>,
  workOrders: WorkOrder[]
): number[] {
  const productionRowIndices: number[] = [];
  // Track which work order rows we've already processed to handle duplicates
  const processedWorkOrderRows = new Set<number>();

  for (const workOrder of workOrders) {
    // Allow work order 0 (blank entries) - they should be processed too
    if (workOrder.work_order_number === null) {
      productionRowIndices.push(-1);
      continue;
    }

    // Find the next unprocessed work order row with this number
    let workOrderRowIndex = -1;
    for (let i = 0; i < excelData.length; i++) {
      if (processedWorkOrderRows.has(i)) {
        continue; // Skip already processed rows
      }
      const row = excelData[i];
      const colA = row["A"];
      const workOrderNumber = parseNumericValue(colA);
      if (workOrderNumber === workOrder.work_order_number) {
        workOrderRowIndex = i;
        processedWorkOrderRows.add(i);
        break;
      }
    }

    if (workOrderRowIndex === -1) {
      console.warn(`Could not find work order row for WO ${workOrder.work_order_number}`);
      productionRowIndices.push(-1);
      continue;
    }

    // Find the production row after this specific work order row
    // Production row has "Production" in column F (exact match, case-insensitive)
    let productionRowIndex = -1;
    for (let i = workOrderRowIndex + 1; i < excelData.length; i++) {
      const row = excelData[i];
      const colF = row["F"];
      const colFValue = colF !== null && colF !== undefined ? String(colF).trim().toLowerCase() : "";

      if (colFValue === "production") {
        productionRowIndex = i;
        console.log(`Found production row for WO ${workOrder.work_order_number} at row ${i + 1} (work order row was ${workOrderRowIndex + 1})`);
        break;
      }

      // Stop if we hit the next work order (but skip work order 0)
      const colA = row["A"];
      const nextWorkOrderNumber = parseNumericValue(colA);
      if (nextWorkOrderNumber !== null && nextWorkOrderNumber > 0) {
        console.warn(`Did not find production row for WO ${workOrder.work_order_number} - hit next work order ${nextWorkOrderNumber} at row ${i + 1}`);
        break;
      }
    }

    productionRowIndices.push(productionRowIndex);
  }

  return productionRowIndices;
}

/**
 * Converts time difference to minutes
 * 
 * @param startTime - Start time in HH:MM format
 * @param endTime - End time in HH:MM format
 * @returns Difference in minutes, or null if invalid
 */
function timeDifferenceInMinutes(
  startTime: string | null,
  endTime: string | null
): number | null {
  if (!startTime || !endTime) {
    return null;
  }

  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  // Handle case where end time is next day (e.g., 22:00 to 06:00)
  if (endMinutes < startMinutes) {
    return 1440 - startMinutes + endMinutes; // 1440 = minutes in a day
  }

  return endMinutes - startMinutes;
}

/**
 * Main function to parse a complete production report from an Excel file
 * Orchestrates all parsing functions and returns structured production data
 * 
 * @param file - Excel file object
 * @param filename - Name of the file
 * @returns ProductionReport object with all parsed data, or null if parsing fails
 * 
 * @example
 * const report = await parseProductionReport(file, file.name);
 * if (report) {
 *   console.log(`Press: ${report.press}, Date: ${report.date}`);
 *   console.log(`Shifts: ${report.shifts.length}`);
 *   console.log(`Work Orders: ${report.workOrders.length}`);
 * }
 */
export async function parseProductionReport(
  file: File,
  filename: string
): Promise<ProductionReport | null> {
  try {
    // Step 1: Validate filename and extract press/date
    const validation = validateFileName(filename);
    if (!validation.isValid || !validation.press || !validation.date) {
      throw new Error(validation.error || "Invalid filename format");
    }

    const press = validation.press;
    const date = validation.date;

    // Step 2: Read Excel file
    const excelResult = await parseExcelFile(file);
    if (!excelResult.success || !excelResult.data) {
      throw new Error(excelResult.error || "Failed to parse Excel file");
    }

    const excelData = excelResult.data;

    // Step 3: Parse shift summary
    const shifts = parseShiftSummary(excelData);
    if (shifts.length === 0) {
      // Warning: no shifts found, but continue processing
      console.warn("No shifts found in Excel file");
    } else {
      // Debug: Log extracted shifts to verify team extraction
      console.log(`Extracted ${shifts.length} shifts from Excel:`, shifts.map(s => ({
        shift: s.shift,
        team: s.team,
        start: s.start_time,
        end: s.end_time
      })));
    }

    // Step 4: Parse work orders
    const workOrders = parseWorkOrders(excelData);
    console.log(`Parsed ${workOrders.length} work orders from Excel file`);
    if (workOrders.length === 0) {
      // Warning: no work orders found
      console.warn("No work orders found in Excel file");
      throw new Error("No work orders found in Excel file - cannot create production report");
    }

    // Step 5: Find production row indices for each work order
    // We need to match work orders to their production rows in order to handle duplicates
    const productionRowIndices = findProductionRowIndicesForWorkOrders(excelData, workOrders);

    // Step 6: Enrich each work order with downtime, spoilage, shift, and run speed
    const workOrdersWithDetails: WorkOrderWithDetails[] = workOrders.map((workOrder, index) => {
      const productionRowIndex = productionRowIndices[index] ?? -1;

      // Parse downtime and spoilage events
      const downtime =
        productionRowIndex >= 0
          ? parseDowntimeEvents(excelData, productionRowIndex)
          : [];
      const spoilage =
        productionRowIndex >= 0
          ? parseSpoilageEvents(excelData, productionRowIndex)
          : [];
      
      // Debug: Log downtime and spoilage events found
      if (productionRowIndex >= 0) {
        console.log(`Work order ${workOrder.work_order_number}: Found ${downtime.length} downtime events, ${spoilage.length} spoilage events`);
        if (downtime.length > 0) {
          console.log(`Downtime events:`, downtime.map(e => `${e.category}: ${e.minutes} min`));
        }
        if (spoilage.length > 0) {
          console.log(`Spoilage events:`, spoilage.map(e => `${e.category}: ${e.units} units`));
        }
      } else {
        console.warn(`Work order ${workOrder.work_order_number}: Production row index not found, skipping downtime/spoilage parsing`);
      }

      // Assign work order to shift based on production time
      // Use production start time to determine which shift it belongs to
      const shift = assignWorkOrderToShift(
        workOrder.production.start_time,
        workOrder.production.end_time,
        shifts
      );
      
      // Debug: Log shift assignment
      if (shift) {
        console.log(`Work order ${workOrder.work_order_number} assigned to shift: ${shift.shift}, team: ${shift.team}`);
      } else {
        console.warn(`Work order ${workOrder.work_order_number} could not be assigned to a shift. Production time: ${workOrder.production.start_time} - ${workOrder.production.end_time}`);
        console.warn(`Available shifts:`, shifts.map(s => `${s.shift} (${s.team}) ${s.start_time}-${s.end_time}`));
      }

      // Calculate run speed
      // Need production time in minutes and total downtime in minutes
      const productionMinutes = timeDifferenceInMinutes(
        workOrder.production.start_time,
        workOrder.production.end_time
      );
      const totalDowntimeMinutes = downtime.reduce(
        (sum, event) => sum + (event.minutes || 0),
        0
      );

      const run_speed =
        workOrder.good_production !== null &&
        productionMinutes !== null &&
        totalDowntimeMinutes !== null
          ? calculateRunSpeed(
              workOrder.good_production,
              productionMinutes,
              totalDowntimeMinutes
            )
          : 0;

      return {
        ...workOrder,
        downtime,
        spoilage,
        shift,
        run_speed,
      };
    });

    return {
      press,
      date,
      shifts,
      workOrders: workOrdersWithDetails,
    };
  } catch (error) {
    console.error("Error parsing production report:", error);
    return null;
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

