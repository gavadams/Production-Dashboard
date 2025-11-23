/**
 * Converts technical error messages to user-friendly messages
 * Provides consistent error messaging throughout the application
 */

export interface UserFriendlyError {
  title: string;
  message: string;
  type: "error" | "warning" | "info";
}

/**
 * Converts database/technical errors to user-friendly messages
 * 
 * @param error - Error object or error message string
 * @returns UserFriendlyError object with title and message
 * 
 * @example
 * const friendlyError = getUserFriendlyError("Error: connection timeout");
 * // Returns: { title: "Connection Error", message: "Unable to connect to the database. Please check your internet connection and try again.", type: "error" }
 */
export function getUserFriendlyError(error: unknown): UserFriendlyError {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = errorMessage.toLowerCase();

  // Database connection errors
  if (
    lowerMessage.includes("connection") ||
    lowerMessage.includes("network") ||
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("fetch")
  ) {
    return {
      title: "Connection Error",
      message: "Unable to connect to the database. Please check your internet connection and try again.",
      type: "error",
    };
  }

  // Authentication errors
  if (
    lowerMessage.includes("unauthorized") ||
    lowerMessage.includes("authentication") ||
    lowerMessage.includes("permission") ||
    lowerMessage.includes("access denied")
  ) {
    return {
      title: "Authentication Error",
      message: "You don't have permission to perform this action. Please contact your administrator.",
      type: "error",
    };
  }

  // Validation errors
  if (
    lowerMessage.includes("validation") ||
    lowerMessage.includes("invalid") ||
    lowerMessage.includes("required") ||
    lowerMessage.includes("format")
  ) {
    return {
      title: "Validation Error",
      message: "The data you provided is invalid. Please check your input and try again.",
      type: "warning",
    };
  }

  // File parsing errors
  if (
    lowerMessage.includes("parse") ||
    lowerMessage.includes("excel") ||
    lowerMessage.includes("file") ||
    lowerMessage.includes("xlsx")
  ) {
    return {
      title: "File Processing Error",
      message: "Unable to process the file. Please ensure it's a valid Excel file (.xlsx) and try again.",
      type: "error",
    };
  }

  // Duplicate/conflict errors
  if (
    lowerMessage.includes("duplicate") ||
    lowerMessage.includes("already exists") ||
    lowerMessage.includes("unique constraint") ||
    lowerMessage.includes("conflict")
  ) {
    return {
      title: "Duplicate Entry",
      message: "This record already exists. Please check if the data has already been uploaded.",
      type: "warning",
    };
  }

  // Not found errors
  if (
    lowerMessage.includes("not found") ||
    lowerMessage.includes("does not exist") ||
    lowerMessage.includes("404")
  ) {
    return {
      title: "Not Found",
      message: "The requested data could not be found. It may have been deleted or doesn't exist.",
      type: "info",
    };
  }

  // Database constraint errors
  if (
    lowerMessage.includes("constraint") ||
    lowerMessage.includes("foreign key") ||
    lowerMessage.includes("reference")
  ) {
    return {
      title: "Data Integrity Error",
      message: "The data violates database constraints. Please check your input and try again.",
      type: "error",
    };
  }

  // Generic database errors
  if (
    lowerMessage.includes("database") ||
    lowerMessage.includes("sql") ||
    lowerMessage.includes("query") ||
    lowerMessage.includes("supabase")
  ) {
    return {
      title: "Database Error",
      message: "An error occurred while accessing the database. Please try again later.",
      type: "error",
    };
  }

  // Default fallback
  return {
    title: "An Error Occurred",
    message: "Something went wrong. Please try again. If the problem persists, contact support.",
    type: "error",
  };
}

/**
 * Formats error messages for display in toast notifications
 * 
 * @param error - Error object or error message string
 * @returns Formatted error message string
 */
export function formatErrorMessage(error: unknown): string {
  const friendlyError = getUserFriendlyError(error);
  return friendlyError.message;
}

/**
 * Formats success messages for display in toast notifications
 * 
 * @param message - Success message string
 * @param details - Optional additional details
 * @returns Formatted success message string
 */
export function formatSuccessMessage(message: string, details?: string): string {
  if (details) {
    return `${message} ${details}`;
  }
  return message;
}

