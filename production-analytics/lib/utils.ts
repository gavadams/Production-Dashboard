/**
 * Utility functions for the application
 */

/**
 * Press Status Input
 */
export interface PressStatusInput {
  total_production: number;
  efficiency_pct: number;
  total_downtime_minutes: number;
}

/**
 * Determines press status based on production, efficiency, and downtime
 * 
 * @param input - Press status calculation inputs
 * @returns Status: "running" | "down" | "setup" | "no_work"
 * 
 * Logic:
 * - "running": Production > 0 and Efficiency > 50%
 * - "down": Downtime > 4 hours (240 min)
 * - "setup": Production > 0 but Efficiency ≤ 50%
 * - "no_work": No production recorded
 */
export function determinePressStatus(input: PressStatusInput): "running" | "down" | "setup" | "no_work" {
  const { total_production, efficiency_pct, total_downtime_minutes } = input;

  // Check if press is down (downtime > 4 hours)
  if (total_downtime_minutes > 240) {
    return "down";
  }

  // Check if there's no production
  if (total_production === 0) {
    return "no_work";
  }

  // Check if running (production > 0 and efficiency > 50%)
  if (total_production > 0 && efficiency_pct > 50) {
    return "running";
  }

  // Otherwise, it's setup (production > 0 but efficiency ≤ 50%)
  return "setup";
}

/**
 * Training Priority Calculation Input
 */
export interface TrainingPriorityInput {
  occurrence_count: number;
  total_impact: number; // units or minutes
  variance_from_team_avg: number; // percentage
  trend_direction: "increasing" | "stable" | "decreasing";
  issue_priority: "Critical" | "High" | "Medium" | "Low";
}

/**
 * Training Priority Result
 */
export interface TrainingPriorityResult {
  score: number; // 0-100
  priority_level: "Critical" | "High" | "Medium" | "Low";
}

/**
 * Calculates training priority score based on multiple factors
 * 
 * @param input - Training priority calculation inputs
 * @returns Priority score (0-100) and priority level
 * 
 * @example
 * const result = calculateTrainingPriority({
 *   occurrence_count: 10,
 *   total_impact: 500,
 *   variance_from_team_avg: 50,
 *   trend_direction: 'increasing',
 *   issue_priority: 'High'
 * });
 * console.log(result.score); // e.g., 85
 * console.log(result.priority_level); // e.g., "Critical"
 */
export function calculateTrainingPriority(
  input: TrainingPriorityInput
): TrainingPriorityResult {
  let score = 0;

  // Occurrence weight (0-25 points)
  score += Math.min(input.occurrence_count * 3, 25);

  // Impact weight (0-30 points)
  score += Math.min(input.total_impact / 10, 30);

  // Variance weight (0-20 points)
  score += Math.min(Math.abs(input.variance_from_team_avg), 20);

  // Trend weight (0-15 points)
  if (input.trend_direction === "increasing") {
    score += 15;
  } else if (input.trend_direction === "stable") {
    score += 5;
  }
  // decreasing adds 0 points

  // Issue priority weight (0-10 points)
  const priorityScores: Record<"Critical" | "High" | "Medium" | "Low", number> = {
    Critical: 10,
    High: 7,
    Medium: 5,
    Low: 2,
  };
  score += priorityScores[input.issue_priority] || 5;

  // Ensure score is between 0 and 100
  score = Math.max(0, Math.min(100, score));
  const roundedScore = Math.round(score);

  // Determine priority level based on score
  let priority_level: "Critical" | "High" | "Medium" | "Low";
  if (roundedScore >= 75) {
    priority_level = "Critical";
  } else if (roundedScore >= 50) {
    priority_level = "High";
  } else if (roundedScore >= 25) {
    priority_level = "Medium";
  } else {
    priority_level = "Low";
  }

  return {
    score: roundedScore,
    priority_level,
  };
}
