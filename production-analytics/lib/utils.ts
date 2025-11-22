/**
 * Determines the status of a press based on production data
 * 
 * @param productionData - Production data for a press
 * @returns Status: "running" | "down" | "setup" | "no_work"
 * 
 * @example
 * const status = determinePressStatus({
 *   total_production: 10000,
 *   efficiency_pct: 75,
 *   total_downtime_minutes: 120
 * });
 * // Returns: "running"
 */
export function determinePressStatus(productionData: {
  total_production: number;
  efficiency_pct: number;
  total_downtime_minutes: number;
}): "running" | "down" | "setup" | "no_work" {
  const { total_production, efficiency_pct, total_downtime_minutes } = productionData;

  // Check for "down" status first (highest priority)
  // Press is down if downtime exceeds 4 hours (240 minutes)
  if (total_downtime_minutes > 240) {
    return "down";
  }

  // Check for "no_work" status
  // No production means no work was done
  if (total_production === 0) {
    return "no_work";
  }

  // Check for "running" vs "setup" status
  // Running: production > 0 and efficiency > 50%
  // Setup: production > 0 but efficiency <= 50%
  if (total_production > 0 && efficiency_pct > 50) {
    return "running";
  }

  if (total_production > 0 && efficiency_pct <= 50) {
    return "setup";
  }

  // Default fallback (shouldn't reach here, but TypeScript requires it)
  return "no_work";
}

