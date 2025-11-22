const VALID_PRESS_CODES = ["LA01", "LA02", "LP03", "LP04", "LP05", "CL01"];

export interface FileValidationResult {
  isValid: boolean;
  press?: string;
  date?: string; // DD-MM-YYYY format
  error?: string;
}

/**
 * Validates filename pattern: 857{PRESS}_{DD-MMM-YYYY}.xlsx
 * Extracts press name and date from filename
 * Converts date from DD-MMM-YYYY to DD-MM-YYYY format
 * 
 * @param fileName - The filename to validate (e.g., "857LP05_06-Nov-2025.xlsx")
 * @returns FileValidationResult with validation status, extracted data, or error message
 * 
 * @example
 * validateFileName("857LP05_06-Nov-2025.xlsx")
 * // Returns: { isValid: true, press: "LP05", date: "06-11-2025" }
 */
export function validateFileName(fileName: string): FileValidationResult {
  // Check if file is .xlsx
  if (!fileName.toLowerCase().endsWith(".xlsx")) {
    return {
      isValid: false,
      error: "File must be a .xlsx file",
    };
  }

  // Remove .xlsx extension
  const nameWithoutExt = fileName.replace(/\.xlsx$/i, "");

  // Check pattern: 857{PRESS}_{DD-MMM-YYYY}
  // Note: Month abbreviation can be any case (Nov, NOV, nov)
  const pattern = /^857([A-Z0-9]+)_(\d{2}-[A-Za-z]{3}-\d{4})$/i;
  const match = nameWithoutExt.match(pattern);

  if (!match) {
    return {
      isValid: false,
      error: "Filename must match pattern: 857{PRESS}_{DD-MMM-YYYY}.xlsx (e.g., 857LP05_06-Nov-2025.xlsx)",
    };
  }

  const pressCode = match[1];
  const dateStr = match[2];

  // Validate press code
  if (!VALID_PRESS_CODES.includes(pressCode)) {
    return {
      isValid: false,
      error: `Press code must be one of: ${VALID_PRESS_CODES.join(", ")}`,
      press: pressCode, // Still extract press even if invalid
    };
  }

  // Parse and validate date format (DD-MMM-YYYY)
  const dateResult = parseDate(dateStr);
  if (!dateResult.isValid) {
    return {
      isValid: false,
      error: dateResult.error || "Invalid date format. Use DD-MMM-YYYY (e.g., 15-Jan-2024)",
      press: pressCode,
    };
  }

  return {
    isValid: true,
    press: pressCode,
    date: dateResult.date, // DD-MM-YYYY format
  };
}

/**
 * Parses date string from DD-MMM-YYYY format and converts to DD-MM-YYYY format
 * 
 * @param dateStr - Date string in DD-MMM-YYYY format (e.g., "14-Nov-2025")
 * @returns Object with validation status, converted date (DD-MM-YYYY), or error
 */
function parseDate(dateStr: string): { isValid: boolean; date?: string; error?: string } {
  try {
    // Split the date string (DD-MMM-YYYY)
    const [day, monthAbbr, year] = dateStr.split("-");

    // Map month abbreviations to numbers (case-insensitive)
    const monthMap: Record<string, string> = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12",
    };

    const monthNum = monthMap[monthAbbr.toLowerCase()];
    if (!monthNum) {
      return {
        isValid: false,
        error: `Invalid month. Use 3-letter month abbreviation (e.g., Jan, Feb, Mar). Got: ${monthAbbr}`,
      };
    }

    // Validate day and year are numeric
    const dayNum = parseInt(day, 10);
    const yearNum = parseInt(year, 10);

    if (isNaN(dayNum) || isNaN(yearNum)) {
      return {
        isValid: false,
        error: "Day and year must be numeric values",
      };
    }

    // Validate day range (1-31)
    if (dayNum < 1 || dayNum > 31) {
      return {
        isValid: false,
        error: "Day must be between 1 and 31",
      };
    }

    // Validate year range (reasonable range)
    if (yearNum < 2000 || yearNum > 2100) {
      return {
        isValid: false,
        error: "Year must be between 2000 and 2100",
      };
    }

    // Create date object to validate the actual date
    const date = new Date(`${yearNum}-${monthNum}-${dayNum}`);
    
    // Check if date is valid (catches invalid dates like 32-Jan-2024)
    if (isNaN(date.getTime())) {
      return {
        isValid: false,
        error: "Invalid date. Please check the day, month, and year values.",
      };
    }

    // Verify the date components match (to catch invalid dates like 31-Feb-2024)
    if (
      date.getDate() !== dayNum ||
      date.getMonth() + 1 !== parseInt(monthNum, 10) ||
      date.getFullYear() !== yearNum
    ) {
      return {
        isValid: false,
        error: "Invalid date. Please check the day, month, and year values.",
      };
    }

    // Format as DD-MM-YYYY (pad day with zero if needed)
    const formattedDay = dayNum.toString().padStart(2, "0");
    const formattedDate = `${formattedDay}-${monthNum}-${yearNum}`;

    return {
      isValid: true,
      date: formattedDate,
    };
  } catch {
    return {
      isValid: false,
      error: "Invalid date format. Use DD-MMM-YYYY (e.g., 15-Jan-2024)",
    };
  }
}

/**
 * Get list of valid press codes
 * 
 * @returns Array of valid press codes
 */
export function getValidPressCodes(): string[] {
  return [...VALID_PRESS_CODES];
}

