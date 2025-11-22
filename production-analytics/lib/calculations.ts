/**
 * Calculates run speed (sheets per hour) based on production data
 * 
 * @param good_production - Number of good production units
 * @param production_minutes - Total production time in minutes
 * @param logged_downtime_minutes - Logged downtime in minutes
 * @returns Run speed in sheets per hour, rounded to 2 decimal places, or 0 if invalid
 * 
 * @example
 * const runSpeed = calculateRunSpeed(1000, 120, 20);
 * // Returns: 600.00 (1000 / (120 - 20) * 60 = 1000 / 100 * 60 = 600)
 */
export function calculateRunSpeed(
  good_production: number,
  production_minutes: number,
  logged_downtime_minutes: number
): number {
  // Validate inputs
  if (
    typeof good_production !== "number" ||
    typeof production_minutes !== "number" ||
    typeof logged_downtime_minutes !== "number"
  ) {
    return 0;
  }

  // Calculate actual running minutes
  const actual_running_minutes = production_minutes - logged_downtime_minutes;

  // Handle division by zero or negative values
  if (actual_running_minutes <= 0) {
    return 0;
  }

  // Calculate run speed: (good_production / actual_running_minutes) * 60
  const run_speed = (good_production / actual_running_minutes) * 60;

  // Round to 2 decimal places
  return Math.round(run_speed * 100) / 100;
}

