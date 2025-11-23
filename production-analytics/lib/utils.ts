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

/**
 * Classifies a maintenance alert based on downtime trend data
 * Determines severity level: urgent, warning, or monitor
 * 
 * @param trend - Downtime trend record with pct_change and total_minutes
 * @param consecutiveWeeksIncreasing - Optional: number of consecutive weeks with increasing trend (default: 0)
 * @returns Severity classification: "urgent" | "warning" | "monitor"
 * 
 * @example
 * const severity = classifyMaintenanceAlert({
 *   pct_change: 75,
 *   total_minutes: 300
 * }, 2);
 * // Returns: "urgent" (total_minutes > 240)
 */
export function classifyMaintenanceAlert(
  trend: {
    pct_change: number;
    total_minutes: number;
  },
  consecutiveWeeksIncreasing: number = 0
): "urgent" | "warning" | "monitor" {
  // "urgent": pct_change > 100% OR total_minutes > 240 in current week
  if (trend.pct_change > 100 || trend.total_minutes > 240) {
    return "urgent";
  }

  // "warning": pct_change > 50% OR increasing for 3+ consecutive weeks
  if (trend.pct_change > 50 || consecutiveWeeksIncreasing >= 3) {
    return "warning";
  }

  // "monitor": pct_change > 0% but below warning threshold
  if (trend.pct_change > 0) {
    return "monitor";
  }

  // If pct_change <= 0, it's not an increasing trend, so return "monitor" as default
  // (though this function is meant for increasing trends only)
  return "monitor";
}

/**
 * Gets maintenance recommendation based on downtime category
 * Maps common downtime categories to specific recommended actions
 * 
 * @param category - Downtime category string
 * @returns Recommended action string
 * 
 * @example
 * const recommendation = getMaintenanceRecommendation("Mechanical Breakdown");
 * // Returns: "Schedule immediate inspection"
 */
export function getMaintenanceRecommendation(category: string): string {
  if (!category || typeof category !== "string") {
    return "Investigate root cause and schedule maintenance";
  }

  const categoryLower = category.trim().toLowerCase();

  // Map of category keywords to recommendations
  const recommendationMap: Record<string, string> = {
    // Mechanical issues
    "mechanical breakdown": "Schedule immediate inspection",
    "mechanical": "Schedule mechanical inspection",
    "breakdown": "Schedule immediate inspection",
    
    // Feeder issues
    "feeder crash": "Check feeder alignment and sensors",
    "crash at feeder": "Check feeder alignment and sensors",
    "feeder": "Inspect feeder mechanism and alignment",
    
    // Cylinder issues
    "pimples": "Inspect cylinder cleaning system",
    "cylinder": "Inspect cylinder condition and cleaning system",
    "impression cylinder": "Inspect impression cylinder and cleaning system",
    "impression cylinder wash": "Review cylinder cleaning procedures",
    
    // Varnish issues
    "varnish fail": "Check varnish system and blanket tension",
    "varnish": "Inspect varnish application system",
    "varnish finish": "Check varnish finish quality and application",
    
    // Blanket issues
    "blanket": "Inspect blanket condition and tension",
    "blanket change": "Review blanket replacement schedule",
    "blanket / packing change": "Inspect blanket and packing condition",
    
    // Camera/Quality issues
    "camera faults": "Calibrate camera system and check sensors",
    "camera": "Inspect camera alignment and calibration",
    
    // Material/Coating issues
    "coating": "Check coating application system",
    "coating drips": "Inspect coating application and quality",
    "material-coating": "Review material handling and coating process",
    
    // Bulk/Setup issues
    "changing bulks": "Review bulk change procedures and efficiency",
    "bulks": "Optimize bulk change process",
    "setting up": "Review setup procedures and training",
    "start up": "Review startup procedures and efficiency",
    
    // Repro/Plate issues
    "repro error": "Review repro and plate preparation process",
    "repro error / plates": "Check plate quality and repro procedures",
    "plates": "Inspect plate condition and preparation",
    
    // Damage/Quality issues
    "damaged edges": "Review material handling procedures",
    "damaged edges/bent corner": "Improve material handling and quality control",
    "bent corner": "Review material handling procedures",
    
    // Gripper issues
    "grippers": "Inspect gripper mechanism and adjustment",
    
    // Breaks/Operational
    "breaks": "Review break scheduling and coverage",
    "shutdown": "Review shutdown and startup procedures",
    "startup": "Review startup procedures and efficiency",
  };

  // Try exact match first
  if (recommendationMap[categoryLower]) {
    return recommendationMap[categoryLower];
  }

  // Try partial matches (category contains keyword or keyword contains category)
  for (const [key, value] of Object.entries(recommendationMap)) {
    if (categoryLower.includes(key) || key.includes(categoryLower)) {
      return value;
    }
  }

  // Default recommendation
  return "Investigate root cause and schedule maintenance";
}

