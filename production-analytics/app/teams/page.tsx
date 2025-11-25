"use client";

import { useState, useEffect, useCallback } from "react";
import { Filter, ArrowUpDown, ArrowUp, ArrowDown, GraduationCap, Users, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, X, CheckCircle, AlertCircle, RefreshCw, History, Target } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { getTeamPerformance, getTeamTrainingNeeds, getTrainingRecommendationFromDB, getRecurringIssues, getTrainingRecords, updateTrainingEffectiveness } from "@/lib/database";
import type { TeamPerformanceData, TeamTrainingNeed, TrainingRecommendation, RecurringIssue, TrainingRecord } from "@/lib/database";
import { formatErrorMessage } from "@/lib/errorMessages";
import { calculateTrainingPriority } from "@/lib/utils";
import EmptyState from "@/components/EmptyState";
import ComparisonChart from "@/components/ComparisonChart";
import MarkTrainingCompletedModal from "@/components/MarkTrainingCompletedModal";
import {
  BarChart,
  Bar,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const PRESS_CODES = ["LA01", "LA02", "LP03", "LP04", "LP05", "CL01"];
const SHIFTS = ["Earlies", "Lates", "Nights"];
const TEAMS = ["A", "B", "C"];
const DATE_RANGES = [
  { label: "Last 7 days", value: 7 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
];

type SortColumn = "team_identifier" | "total_runs" | "total_production" | "avg_run_speed" | "avg_make_ready_minutes" | "avg_spoilage_pct";
type SortDirection = "asc" | "desc";

export default function TeamsPage() {
  const [selectedPress, setSelectedPress] = useState<string>("");
  const [selectedShift, setSelectedShift] = useState<string>("");
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  const [selectedDaysBack, setSelectedDaysBack] = useState<number>(30);
  
  // Calculate date range based on daysBack
  const getDateRange = (daysBack: number) => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    return {
      startDate: startDate.toISOString().split("T")[0],
      endDate: endDate.toISOString().split("T")[0],
    };
  };
  const [teams, setTeams] = useState<TeamPerformanceData[]>([]);
  const [enhancedTrainingNeeds, setEnhancedTrainingNeeds] = useState<Array<TeamTrainingNeed & {
    recurringIssue?: RecurringIssue;
    trainingRecommendation?: TrainingRecommendation;
    bestPerformingTeam?: { team: string; occurrences: number };
    opportunityReduction?: number;
    estimatedCost?: number;
    priorityScore?: number;
    priorityLevel?: "Critical" | "High" | "Medium" | "Low";
  }>>([]);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [markTrainingModal, setMarkTrainingModal] = useState<{
    teamIdentifier: string;
    issueCategory: string;
    trainingRecommendation: TrainingRecommendation | undefined;
    press: string;
    issueType: "Spoilage" | "Downtime";
  } | null>(null);
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([]);
  const [trainingHistoryLoading, setTrainingHistoryLoading] = useState(false);
  const [trainingHistoryFilters, setTrainingHistoryFilters] = useState<{
    teamIdentifier: string;
    issueCategory: string;
    startDate: string;
    endDate: string;
    effectivenessRating: string;
  }>({
    teamIdentifier: "",
    issueCategory: "",
    startDate: "",
    endDate: "",
    effectivenessRating: "",
  });
  const [trainingHistorySortColumn, setTrainingHistorySortColumn] = useState<keyof TrainingRecord>("training_completed_date");
  const [trainingHistorySortDirection, setTrainingHistorySortDirection] = useState<"asc" | "desc">("desc");
  const [refreshingEffectiveness, setRefreshingEffectiveness] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>("avg_run_speed");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const fetchTeamData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { startDate, endDate } = getDateRange(selectedDaysBack);
      const data = await getTeamPerformance({
        press: selectedPress || undefined,
        shift: selectedShift || undefined,
        team: selectedTeam || undefined,
        startDate,
        endDate,
      });

      setTeams(data);

      // Fetch training needs (use daysBack for lookback period)
      const trainingData = await getTeamTrainingNeeds(selectedDaysBack, 3);

      // Enhance training needs with recurring issues data and training recommendations
      const enhancedData = await Promise.all(
        trainingData.map(async (need) => {
          // Get enhanced recurring issue data for this category and press
          const recurringIssues = await getRecurringIssues(
            selectedDaysBack,
            need.press,
            need.issue_type === "Spoilage" ? "spoilage" : "downtime"
          );
          const recurringIssue = recurringIssues.find((issue) => issue.category === need.issue_category);

          // Get training recommendation from database
          const trainingRecommendation = await getTrainingRecommendationFromDB(need.issue_category);

          // Find best performing team for this category
          // Query all teams for this category to find the one with lowest occurrences
          const allTeamNeeds = await getTeamTrainingNeeds(selectedDaysBack, 0);
          const categoryTeamNeeds = allTeamNeeds.filter(
            (tn) => tn.issue_category === need.issue_category && tn.press === need.press
          );
          const bestPerformingTeam = categoryTeamNeeds.length > 0
            ? categoryTeamNeeds.reduce((best, current) => 
                current.occurrence_count < best.occurrence_count ? current : best
              )
            : undefined;

          // Calculate opportunity reduction
          const opportunityReduction = bestPerformingTeam && need.occurrence_count > 0
            ? ((need.occurrence_count - bestPerformingTeam.occurrence_count) / need.occurrence_count) * 100
            : undefined;

          // Estimate cost (rough calculation: assume £0.10 per unit for spoilage, £50/hour for downtime)
          let estimatedCost: number | undefined;
          if (need.issue_type === "Spoilage") {
            estimatedCost = need.total_impact * 0.10; // £0.10 per unit
          } else {
            estimatedCost = (need.total_impact / 60) * 50; // £50 per hour
          }

          // Calculate priority score
          let priorityScore: number | undefined;
          let priorityLevel: "Critical" | "High" | "Medium" | "Low" | undefined;
          if (recurringIssue && trainingRecommendation) {
            const priorityResult = calculateTrainingPriority({
              occurrence_count: need.occurrence_count,
              total_impact: need.total_impact,
              variance_from_team_avg: recurringIssue.variance_from_avg,
              trend_direction: recurringIssue.trend,
              issue_priority: trainingRecommendation.priority,
            });
            priorityScore = priorityResult.score;
            priorityLevel = priorityResult.priority_level;
          }

          return {
            ...need,
            recurringIssue,
            trainingRecommendation: trainingRecommendation || undefined,
            bestPerformingTeam: bestPerformingTeam ? {
              team: bestPerformingTeam.team_identifier,
              occurrences: bestPerformingTeam.occurrence_count,
            } : undefined,
            opportunityReduction,
            estimatedCost,
            priorityScore,
            priorityLevel,
          };
        })
      );

      setEnhancedTrainingNeeds(enhancedData);
    } catch (err) {
      console.error("Error fetching team data:", err);
      const errorMsg = formatErrorMessage(err);
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [selectedPress, selectedShift, selectedTeam, selectedDaysBack]);

  useEffect(() => {
    fetchTeamData();
  }, [fetchTeamData]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const sortedTeams = [...teams].sort((a, b) => {
    let aValue: number | string = a[sortColumn];
    let bValue: number | string = b[sortColumn];

    if (sortColumn === "team_identifier") {
      aValue = a.team_identifier;
      bValue = b.team_identifier;
    }

    if (typeof aValue === "string" && typeof bValue === "string") {
      return sortDirection === "asc"
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    const aNum = typeof aValue === "number" ? aValue : 0;
    const bNum = typeof bValue === "number" ? bValue : 0;

    return sortDirection === "asc" ? aNum - bNum : bNum - aNum;
  });

  // Find top performer (fastest avg speed)
  const topPerformer = sortedTeams.length > 0 && sortedTeams[0].avg_run_speed > 0
    ? sortedTeams[0].team_identifier
    : null;

  // Find teams needing attention
  const avgSpeed = teams.length > 0
    ? teams.reduce((sum, t) => sum + t.avg_run_speed, 0) / teams.length
    : 0;
  const needsAttention = (team: TeamPerformanceData) => {
    // High spoilage (>2%) or slow speed (<80% of average)
    return team.avg_spoilage_pct > 2 || (avgSpeed > 0 && team.avg_run_speed < avgSpeed * 0.8);
  };

  const getRowClassName = (team: TeamPerformanceData) => {
    if (team.team_identifier === topPerformer) {
      return "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800";
    }
    if (needsAttention(team)) {
      if (team.avg_spoilage_pct > 3 || (avgSpeed > 0 && team.avg_run_speed < avgSpeed * 0.7)) {
        return "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800";
      }
      return "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800";
    }
    return "";
  };

  const SortIcon = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-4 w-4 text-gray-400" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
    ) : (
      <ArrowDown className="h-4 w-4 text-blue-600 dark:text-blue-400" />
    );
  };

  const handleIgnoreIssue = async (category: string, issueType: "downtime" | "spoilage", press: string) => {
    try {
      const { error } = await supabase
        .from("ignored_issue_categories")
        .insert({
          category,
          issue_type: issueType,
          press: press || null,
          ignored_by: "System", // Could be enhanced to track actual user
          reason: "Ignored from training recommendations",
        });

      if (error) {
        if (error.code === "23505") {
          // Unique constraint violation - already ignored
          toast.success("This issue is already ignored");
        } else {
          throw error;
        }
      } else {
        toast.success("Issue ignored successfully");
        fetchTeamData(); // Refresh data
      }
    } catch (err) {
      console.error("Error ignoring issue:", err);
      toast.error("Failed to ignore issue");
    }
  };

  const handleMarkTrainingCompleted = (
    teamIdentifier: string,
    issueCategory: string,
    trainingRecommendation: TrainingRecommendation | undefined,
    press: string,
    issueType: "Spoilage" | "Downtime"
  ) => {
    setMarkTrainingModal({
      teamIdentifier,
      issueCategory,
      trainingRecommendation,
      press,
      issueType,
    });
  };

  const handleTrainingCompletedSuccess = async () => {
    // Refresh training needs to remove completed item
    await fetchTeamData();
    // Also refresh training records
    await fetchTrainingRecords();
  };

  const fetchTrainingRecords = async () => {
    setTrainingHistoryLoading(true);
    try {
      const records = await getTrainingRecords({
        teamIdentifier: trainingHistoryFilters.teamIdentifier || undefined,
        issueCategory: trainingHistoryFilters.issueCategory || undefined,
        startDate: trainingHistoryFilters.startDate || undefined,
        endDate: trainingHistoryFilters.endDate || undefined,
        effectivenessRating: trainingHistoryFilters.effectivenessRating || undefined,
      });
      setTrainingRecords(records);
    } catch (err) {
      console.error("Error fetching training records:", err);
      toast.error("Failed to fetch training records");
    } finally {
      setTrainingHistoryLoading(false);
    }
  };

  const handleRefreshEffectiveness = async () => {
    setRefreshingEffectiveness(true);
    try {
      const summary = await updateTrainingEffectiveness();
      toast.success(`Updated ${summary.recordsProcessed} training record(s)`);
      await fetchTrainingRecords(); // Refresh the records
    } catch (err) {
      console.error("Error refreshing effectiveness:", err);
      toast.error("Failed to refresh effectiveness data");
    } finally {
      setRefreshingEffectiveness(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Team Performance</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Compare team performance metrics across presses and shifts
        </p>
      </div>

      {/* Recommended Actions Panel */}
      {!loading && !error && enhancedTrainingNeeds.length > 0 && (() => {
        const topPriorities = [...enhancedTrainingNeeds]
          .filter((need) => need.priorityScore !== undefined)
          .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
          .slice(0, 3);

        if (topPriorities.length === 0) return null;

        return (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Target className="h-6 w-6 text-blue-600 dark:text-blue-400" />
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
                Recommended Actions
              </h2>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Top {topPriorities.length} Priority Training Needs
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {topPriorities.map((need, index) => {
                const cardId = `${need.team_identifier}-${need.issue_category}-${index}`;
                const priorityScore = need.priorityScore || 0;
                const priorityLevel = need.priorityLevel || "Medium";
                const trainingRec = need.trainingRecommendation;

                const priorityColors = {
                  Critical: "bg-red-500",
                  High: "bg-orange-500",
                  Medium: "bg-yellow-500",
                  Low: "bg-green-500",
                };

                const handleTakeAction = () => {
                  // Expand the card if not already expanded
                  const newExpanded = new Set(expandedCards);
                  newExpanded.add(cardId);
                  setExpandedCards(newExpanded);

                  // Scroll to the card
                  setTimeout(() => {
                    const element = document.getElementById(cardId);
                    if (element) {
                      element.scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                  }, 100);
                };

                return (
                  <div
                    key={cardId}
                    id={`recommended-${cardId}`}
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border-2 border-blue-300 dark:border-blue-700 p-5 hover:shadow-xl transition-shadow"
                  >
                    {/* Priority Score Progress Bar */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Priority Score
                        </span>
                        <span className="text-sm font-bold text-gray-900 dark:text-white">
                          {priorityScore}/100
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
                        <div
                          className={`h-full ${priorityColors[priorityLevel]} transition-all duration-500`}
                          style={{ width: `${Math.min(priorityScore, 100)}%` }}
                        />
                      </div>
                      <div className="mt-1">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            priorityLevel === "Critical"
                              ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                              : priorityLevel === "High"
                              ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
                              : priorityLevel === "Medium"
                              ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                              : "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                          }`}
                        >
                          {priorityLevel} Priority
                        </span>
                      </div>
                    </div>

                    {/* Team + Issue */}
                    <div className="mb-4">
                      <div className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                        {need.issue_category}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        Team: <span className="font-medium text-gray-900 dark:text-white">{need.team_identifier}</span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {need.press} • {need.shift}
                      </div>
                    </div>

                    {/* Quick Stats */}
                    <div className="mb-4 space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Occurrences:</span>
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {need.occurrence_count}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Impact:</span>
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {need.issue_type === "Spoilage"
                            ? `${need.total_impact.toFixed(0)} units`
                            : `${Math.round(need.total_impact)} min`}
                        </span>
                      </div>
                      {need.estimatedCost !== undefined && need.estimatedCost > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-600 dark:text-gray-400">Est. Cost:</span>
                          <span className="font-semibold text-red-600 dark:text-red-400">
                            £{need.estimatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Recommended Training */}
                    {trainingRec && (
                      <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                        <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                          Recommended Training:
                        </div>
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">
                          {trainingRec.training_title}
                        </div>
                        {trainingRec.expected_improvement_pct && (
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                            Expected improvement:{" "}
                            <span className="font-medium text-green-600 dark:text-green-400">
                              {trainingRec.expected_improvement_pct}%
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Take Action Button */}
                    <button
                      onClick={handleTakeAction}
                      className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
                    >
                      <Target className="h-4 w-4" />
                      Take Action
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Filters</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Press Filter */}
          <div>
            <label htmlFor="press-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Press
            </label>
            <select
              id="press-filter"
              value={selectedPress}
              onChange={(e) => setSelectedPress(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Presses</option>
              {PRESS_CODES.map((press) => (
                <option key={press} value={press}>
                  {press}
                </option>
              ))}
            </select>
          </div>

          {/* Shift Filter */}
          <div>
            <label htmlFor="shift-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Shift
            </label>
            <select
              id="shift-filter"
              value={selectedShift}
              onChange={(e) => setSelectedShift(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Shifts</option>
              {SHIFTS.map((shift) => (
                <option key={shift} value={shift}>
                  {shift}
                </option>
              ))}
            </select>
          </div>

          {/* Team Filter */}
          <div>
            <label htmlFor="team-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Team
            </label>
            <select
              id="team-filter"
              value={selectedTeam}
              onChange={(e) => setSelectedTeam(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Teams</option>
              {TEAMS.map((team) => (
                <option key={team} value={team}>
                  Team {team}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range Filter */}
          <div>
            <label htmlFor="date-range-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Date Range
            </label>
            <select
              id="date-range-filter"
              value={selectedDaysBack}
              onChange={(e) => setSelectedDaysBack(Number(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {DATE_RANGES.map((range) => (
                <option key={range.value} value={range.value}>
                  {range.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Loading State - Skeleton Loaders */}
      {loading && (
        <div className="space-y-6 animate-pulse">
          {/* Table Skeleton */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-6">
              <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                    <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* Charts Skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
              <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
              <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && (
        <>
          {sortedTeams.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-12">
              <EmptyState
                icon={Users}
                title="No Team Data Found"
                description={`No team performance data matches your current filters. Try adjusting the press, shift, team, or date range to see results.`}
                action={{
                  label: "Clear Filters",
                  onClick: () => {
                    setSelectedPress("");
                    setSelectedShift("");
                    setSelectedTeam("");
                    setSelectedDaysBack(30);
                  },
                }}
              />
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Mobile Card View */}
              <div className="md:hidden divide-y divide-gray-200 dark:divide-gray-700">
                {sortedTeams.map((team) => (
                  <div
                    key={team.team_identifier}
                    className={`p-4 ${getRowClassName(team)}`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {team.team_identifier}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {team.press} • {team.shift} • {team.team}
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">Runs:</span>
                          <span className="ml-1 font-medium text-gray-900 dark:text-white">{team.total_runs}</span>
                        </div>
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">Production:</span>
                          <span className="ml-1 font-medium text-gray-900 dark:text-white">{team.total_production.toLocaleString()}</span>
                        </div>
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">Speed:</span>
                          <span className="ml-1 font-medium text-gray-900 dark:text-white">{team.avg_run_speed.toFixed(1)} /hr</span>
                        </div>
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">Make Ready:</span>
                          <span className="ml-1 font-medium text-gray-900 dark:text-white">{team.avg_make_ready_minutes.toFixed(0)} min</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-gray-600 dark:text-gray-400">Spoilage:</span>
                          <span className={`ml-1 font-medium ${team.avg_spoilage_pct > 2 ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white"}`}>
                            {team.avg_spoilage_pct.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                        onClick={() => handleSort("team_identifier")}
                      >
                        <div className="flex items-center gap-2">
                          Team
                          <SortIcon column="team_identifier" />
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                        onClick={() => handleSort("total_runs")}
                      >
                        <div className="flex items-center gap-2">
                          Runs
                          <SortIcon column="total_runs" />
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                        onClick={() => handleSort("total_production")}
                      >
                        <div className="flex items-center gap-2">
                          Total Production
                          <SortIcon column="total_production" />
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                        onClick={() => handleSort("avg_run_speed")}
                      >
                        <div className="flex items-center gap-2">
                          Avg Speed
                          <SortIcon column="avg_run_speed" />
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                        onClick={() => handleSort("avg_make_ready_minutes")}
                      >
                        <div className="flex items-center gap-2">
                          Avg Make Ready
                          <SortIcon column="avg_make_ready_minutes" />
                        </div>
                      </th>
                      <th
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                        onClick={() => handleSort("avg_spoilage_pct")}
                      >
                        <div className="flex items-center gap-2">
                          Avg Spoilage %
                          <SortIcon column="avg_spoilage_pct" />
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                    {sortedTeams.map((team) => (
                    <tr
                      key={team.team_identifier}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${getRowClassName(team)}`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {team.team_identifier}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {team.press} • {team.shift} • {team.team}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {team.total_runs}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {team.total_production.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {team.avg_run_speed.toFixed(1)} <span className="text-gray-500">/hr</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {Math.round(team.avg_make_ready_minutes)} <span className="text-gray-500">min</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <span
                          className={
                            team.avg_spoilage_pct > 2
                              ? "text-red-600 dark:text-red-400 font-medium"
                              : team.avg_spoilage_pct > 1
                              ? "text-yellow-600 dark:text-yellow-400 font-medium"
                              : "text-gray-900 dark:text-white"
                          }
                        >
                          {team.avg_spoilage_pct.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
          )}
        </>
      )}

      {/* Charts Section */}
      {!loading && !error && sortedTeams.length > 0 && (
        <div className="mt-12 space-y-8">
          {/* Average Run Speed Bar Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Average Run Speed by Team
            </h2>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart
                data={sortedTeams.map((team) => ({
                  team: team.team_identifier,
                  speed: team.avg_run_speed,
                  isAboveAverage: team.avg_run_speed >= avgSpeed,
                }))}
                margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                <XAxis
                  dataKey="team"
                  angle={-45}
                  textAnchor="end"
                  height={100}
                  stroke="#6b7280"
                  className="dark:stroke-gray-400"
                  tick={{ fill: "#6b7280", fontSize: 12 }}
                />
                <YAxis
                  stroke="#6b7280"
                  className="dark:stroke-gray-400"
                  tick={{ fill: "#6b7280" }}
                  label={{
                    value: "Speed (sheets/hour)",
                    angle: -90,
                    position: "insideLeft",
                    style: { textAnchor: "middle", fill: "#6b7280" },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [`${value.toFixed(1)} /hr`, "Avg Speed"]}
                />
                <Bar
                  dataKey="speed"
                  radius={[8, 8, 0, 0]}
                  name="Avg Speed"
                >
                  {sortedTeams.map((team) => (
                    <Cell
                      key={team.team_identifier}
                      fill={team.avg_run_speed >= avgSpeed ? "#10b981" : "#ef4444"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-4 flex items-center justify-center gap-4 text-sm text-gray-600 dark:text-gray-400">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-green-500 rounded"></div>
                <span>Above Average ({avgSpeed.toFixed(1)} /hr)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-red-500 rounded"></div>
                <span>Below Average</span>
              </div>
            </div>
          </div>

          {/* Team Performance Radar Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Team Performance Comparison
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sortedTeams.slice(0, 6).map((team) => {
                // Calculate efficiency (inverse of spoilage, normalized)
                const efficiency = Math.max(0, 100 - team.avg_spoilage_pct * 10);
                
                // Normalize metrics for radar chart (0-100 scale)
                const maxSpeed = Math.max(...sortedTeams.map((t) => t.avg_run_speed), 1);
                const maxMakeReady = Math.max(...sortedTeams.map((t) => t.avg_make_ready_minutes), 1);
                const maxSpoilage = Math.max(...sortedTeams.map((t) => t.avg_spoilage_pct), 1);

                const radarData = [
                  {
                    metric: "Speed",
                    value: Math.min(100, (team.avg_run_speed / maxSpeed) * 100),
                    fullMark: 100,
                  },
                  {
                    metric: "Efficiency",
                    value: efficiency,
                    fullMark: 100,
                  },
                  {
                    metric: "Make Ready",
                    value: Math.min(100, 100 - (team.avg_make_ready_minutes / maxMakeReady) * 100), // Inverted (lower is better)
                    fullMark: 100,
                  },
                  {
                    metric: "Quality",
                    value: Math.min(100, 100 - (team.avg_spoilage_pct / maxSpoilage) * 100), // Inverted (lower spoilage is better)
                    fullMark: 100,
                  },
                ];

                return (
                  <div key={team.team_identifier} className="flex flex-col items-center">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                      {team.team_identifier}
                    </h3>
                    <ResponsiveContainer width="100%" height={250}>
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="#e5e7eb" className="dark:stroke-gray-700" />
                        <PolarAngleAxis
                          dataKey="metric"
                          tick={{ fill: "#6b7280", fontSize: 11 }}
                        />
                        <PolarRadiusAxis
                          angle={90}
                          domain={[0, 100]}
                          tick={{ fill: "#6b7280", fontSize: 10 }}
                        />
                        <Radar
                          name={team.team_identifier}
                          dataKey="value"
                          stroke="#3b82f6"
                          fill="#3b82f6"
                          fillOpacity={0.6}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "white",
                            border: "1px solid #e5e7eb",
                            borderRadius: "8px",
                          }}
                          formatter={(value: number) => [`${value.toFixed(1)}%`, "Score"]}
                        />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Training Opportunities Section */}
      {!loading && !error && enhancedTrainingNeeds.length > 0 && (
        <div className="mt-12">
          <div className="flex items-center gap-2 mb-6">
            <GraduationCap className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              Training Opportunities
            </h2>
          </div>

          <div className="space-y-4">
            {enhancedTrainingNeeds
              .sort((a, b) => {
                // Sort by calculated priority score if available, otherwise by recurring issue priority score, then by occurrence count
                const aScore = a.priorityScore || a.recurringIssue?.priority_score || a.occurrence_count;
                const bScore = b.priorityScore || b.recurringIssue?.priority_score || b.occurrence_count;
                return bScore - aScore;
              })
              .map((need, index) => {
                const cardId = `${need.team_identifier}-${need.issue_category}-${index}`;
                const isExpanded = expandedCards.has(cardId);
                const recurringIssue = need.recurringIssue;
                const trainingRec = need.trainingRecommendation;

                // Get priority badge color - use calculated priority level if available, otherwise use training recommendation priority
                const priority = need.priorityLevel || trainingRec?.priority || "Medium";
                const priorityColors = {
                  Critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-300 dark:border-red-700",
                  High: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-orange-300 dark:border-orange-700",
                  Medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700",
                  Low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-300 dark:border-green-700",
                };

                // Get trend icon
                const getTrendIcon = (trend?: "increasing" | "stable" | "decreasing") => {
                  if (!trend) return null;
                  switch (trend) {
                    case "increasing":
                      return <TrendingUp className="h-4 w-4 text-red-600 dark:text-red-400" />;
                    case "decreasing":
                      return <TrendingDown className="h-4 w-4 text-green-600 dark:text-green-400" />;
                    case "stable":
                      return <Minus className="h-4 w-4 text-gray-600 dark:text-gray-400" />;
                  }
                };

                return (
                  <div
                    id={cardId}
                    key={cardId}
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden"
                  >
                    {/* Header - Always Visible */}
                    <div
                      className="p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      onClick={() => {
                        const newExpanded = new Set(expandedCards);
                        if (isExpanded) {
                          newExpanded.delete(cardId);
                        } else {
                          newExpanded.add(cardId);
                        }
                        setExpandedCards(newExpanded);
                      }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                              {need.issue_category}
                            </h3>
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${priorityColors[priority]}`}
                            >
                              {priority}
                              {need.priorityScore !== undefined && (
                                <span className="ml-1 text-xs opacity-75">
                                  ({need.priorityScore})
                                </span>
                              )}
                            </span>
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                need.issue_type === "Spoilage"
                                  ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                  : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                              }`}
                            >
                              {need.issue_type}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            Team: <span className="font-medium text-gray-900 dark:text-white">{need.team_identifier}</span> • {need.press} • {need.shift}
                          </div>
                        </div>
                        <button className="ml-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                          {isExpanded ? (
                            <ChevronUp className="h-5 w-5" />
                          ) : (
                            <ChevronDown className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-4 border-t border-gray-200 dark:border-gray-700">
                        {/* Metrics Section */}
                        <div className="pt-4">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Metrics</h4>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                              <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">This Team</div>
                              <div className="text-sm font-semibold text-gray-900 dark:text-white">
                                {need.occurrence_count} occurrences
                              </div>
                              <div className="text-xs text-gray-600 dark:text-gray-400">
                                {need.issue_type === "Spoilage"
                                  ? `${need.total_impact.toFixed(0)} units impact`
                                  : `${Math.round(need.total_impact)} min impact`}
                              </div>
                            </div>
                            {recurringIssue && (
                              <>
                                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Team Average</div>
                                  <div className="text-sm font-semibold text-gray-900 dark:text-white">
                                    {recurringIssue.team_avg.toFixed(1)} occurrences
                                  </div>
                                  <div className="text-xs text-gray-600 dark:text-gray-400">
                                    {need.issue_type === "Spoilage"
                                      ? `${recurringIssue.occurrences > 0 ? (recurringIssue.totalImpact / recurringIssue.occurrences).toFixed(0) : "0"} units avg`
                                      : `${recurringIssue.occurrences > 0 ? Math.round(recurringIssue.totalImpact / recurringIssue.occurrences) : 0} min avg`}
                                  </div>
                                </div>
                                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Variance</div>
                                  <div className={`text-sm font-semibold ${
                                    recurringIssue.variance_from_avg > 0
                                      ? "text-red-600 dark:text-red-400"
                                      : "text-green-600 dark:text-green-400"
                                  }`}>
                                    {recurringIssue.variance_from_avg >= 0 ? "+" : ""}
                                    {recurringIssue.variance_from_avg.toFixed(1)}% above average
                                  </div>
                                </div>
                                <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">Trend</div>
                                  <div className="flex items-center gap-2">
                                    {getTrendIcon(recurringIssue.trend)}
                                    <span className="text-sm font-semibold text-gray-900 dark:text-white capitalize">
                                      {recurringIssue.trend}
                                    </span>
                                  </div>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Comparison Section */}
                        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Team Comparison</h4>
                          {need.bestPerformingTeam && (
                            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-3">
                              <div className="text-sm text-gray-700 dark:text-gray-300">
                                <span className="font-medium">Best performing team:</span>{" "}
                                <span className="font-semibold text-blue-700 dark:text-blue-300">
                                  {need.bestPerformingTeam.team}
                                </span>{" "}
                                with {need.bestPerformingTeam.occurrences} occurrence{need.bestPerformingTeam.occurrences !== 1 ? "s" : ""}
                              </div>
                              {need.opportunityReduction !== undefined && need.opportunityReduction > 0 && (
                                <div className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                                  <span className="font-medium">Opportunity:</span> Could reduce by{" "}
                                  <span className="font-semibold text-green-700 dark:text-green-300">
                                    {need.opportunityReduction.toFixed(1)}%
                                  </span>{" "}
                                  if matched best performer
                                </div>
                              )}
                            </div>
                          )}
                          {/* Team Comparison Chart */}
                          <div className="bg-white dark:bg-gray-700/50 rounded-lg p-4">
                            <ComparisonChart
                              team_identifier={need.team_identifier}
                              issue_category={need.issue_category}
                              time_period={selectedDaysBack}
                              press={need.press}
                              issue_type={need.issue_type === "Spoilage" ? "Spoilage" : "Downtime"}
                            />
                          </div>
                        </div>

                        {/* Cost Impact */}
                        {need.estimatedCost !== undefined && need.estimatedCost > 0 && (
                          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Cost Impact</h4>
                            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                              <div className="text-sm font-semibold text-red-700 dark:text-red-300">
                                Estimated cost: £{need.estimatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in waste
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Training Recommendation */}
                        {trainingRec && (
                          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Training Recommendation</h4>
                            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg p-4">
                              <div className="mb-3">
                                <div className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                                  {trainingRec.training_title}
                                </div>
                                {trainingRec.training_description && (
                                  <div className="text-sm text-gray-700 dark:text-gray-300">
                                    {trainingRec.training_description}
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400 mb-3">
                                {trainingRec.estimated_duration_hours && (
                                  <div className="flex items-center gap-1">
                                    <AlertCircle className="h-4 w-4" />
                                    <span>Duration: {trainingRec.estimated_duration_hours} hours</span>
                                  </div>
                                )}
                                {trainingRec.expected_improvement_pct && (
                                  <div className="flex items-center gap-1">
                                    <TrendingUp className="h-4 w-4" />
                                    <span>Expected improvement: {trainingRec.expected_improvement_pct}%</span>
                                  </div>
                                )}
                              </div>
                              {trainingRec.resources && trainingRec.resources.length > 0 && (
                                <div>
                                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Resources:</div>
                                  <div className="flex flex-wrap gap-2">
                                    {trainingRec.resources.map((resource, idx) => (
                                      <button
                                        key={idx}
                                        className="px-3 py-1.5 bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 text-xs font-medium rounded-md border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          // Handle resource click (could open modal, navigate, etc.)
                                          toast.success(`Opening resource: ${resource}`);
                                        }}
                                      >
                                        {resource}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                          <div className="flex items-center gap-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleIgnoreIssue(need.issue_category, need.issue_type === "Spoilage" ? "spoilage" : "downtime", need.press);
                              }}
                              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
                            >
                              <X className="h-4 w-4" />
                              Ignore This Issue
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMarkTrainingCompleted(
                                  need.team_identifier,
                                  need.issue_category,
                                  need.trainingRecommendation,
                                  need.press,
                                  need.issue_type === "Spoilage" ? "Spoilage" : "Downtime"
                                );
                              }}
                              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
                            >
                              <CheckCircle className="h-4 w-4" />
                              Mark Training Completed
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Legend */}
      {!loading && !error && sortedTeams.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-4 text-sm text-gray-600 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded"></div>
            <span>Top Performer (Fastest Avg Speed)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700 rounded"></div>
            <span>Needs Attention (High Spoilage or Slow Speed)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded"></div>
            <span>Critical (Spoilage &gt;3% or Speed &lt;70% of Average)</span>
          </div>
        </div>
      )}

      {/* Mark Training Completed Modal */}
      {markTrainingModal && (
        <MarkTrainingCompletedModal
          isOpen={!!markTrainingModal}
          onClose={() => setMarkTrainingModal(null)}
          teamIdentifier={markTrainingModal.teamIdentifier}
          issueCategory={markTrainingModal.issueCategory}
          trainingRecommendation={markTrainingModal.trainingRecommendation}
          press={markTrainingModal.press}
          issueType={markTrainingModal.issueType}
          onSuccess={handleTrainingCompletedSuccess}
        />
      )}

      {/* Training History Section */}
      <div className="mt-12">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <History className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              Training History
            </h2>
          </div>
          <button
            onClick={handleRefreshEffectiveness}
            disabled={refreshingEffectiveness}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-4 w-4 ${refreshingEffectiveness ? "animate-spin" : ""}`} />
            Refresh Effectiveness Data
          </button>
        </div>

        {/* Summary Cards */}
        {!trainingHistoryLoading && trainingRecords.length > 0 && (() => {
          const totalTrainings = trainingRecords.length;
          const recordsWithImprovement = trainingRecords.filter(
            (r) => r.occurrence_reduction_pct !== null
          );
          const avgImprovement =
            recordsWithImprovement.length > 0
              ? recordsWithImprovement.reduce(
                  (sum, r) => sum + (r.occurrence_reduction_pct || 0),
                  0
                ) / recordsWithImprovement.length
              : 0;
          const successCount = trainingRecords.filter(
            (r) => r.effectiveness_rating === "Excellent" || r.effectiveness_rating === "Good"
          ).length;
          const successRate = totalTrainings > 0 ? (successCount / totalTrainings) * 100 : 0;

          // Find most effective category
          const categoryStats = new Map<string, { count: number; avgImprovement: number }>();
          recordsWithImprovement.forEach((r) => {
            const existing = categoryStats.get(r.issue_category) || { count: 0, avgImprovement: 0 };
            categoryStats.set(r.issue_category, {
              count: existing.count + 1,
              avgImprovement: existing.avgImprovement + (r.occurrence_reduction_pct || 0),
            });
          });
          let mostEffectiveCategory = "N/A";
          let highestAvg = -Infinity;
          categoryStats.forEach((stats, category) => {
            const avg = stats.avgImprovement / stats.count;
            if (avg > highestAvg) {
              highestAvg = avg;
              mostEffectiveCategory = category;
            }
          });

          return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Trainings</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{totalTrainings}</div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Average Improvement</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {avgImprovement.toFixed(1)}%
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Success Rate</div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">
                  {successRate.toFixed(1)}%
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {successCount} of {totalTrainings} rated Good or Excellent
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Most Effective Category</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                  {mostEffectiveCategory}
                </div>
                {highestAvg !== -Infinity && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {highestAvg.toFixed(1)}% avg improvement
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Filters */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Filters</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Team
              </label>
              <input
                type="text"
                value={trainingHistoryFilters.teamIdentifier}
                onChange={(e) =>
                  setTrainingHistoryFilters({ ...trainingHistoryFilters, teamIdentifier: e.target.value })
                }
                placeholder="e.g., LP05_A"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Issue Category
              </label>
              <input
                type="text"
                value={trainingHistoryFilters.issueCategory}
                onChange={(e) =>
                  setTrainingHistoryFilters({ ...trainingHistoryFilters, issueCategory: e.target.value })
                }
                placeholder="Filter by category"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Start Date
              </label>
              <input
                type="date"
                value={trainingHistoryFilters.startDate}
                onChange={(e) =>
                  setTrainingHistoryFilters({ ...trainingHistoryFilters, startDate: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                End Date
              </label>
              <input
                type="date"
                value={trainingHistoryFilters.endDate}
                onChange={(e) =>
                  setTrainingHistoryFilters({ ...trainingHistoryFilters, endDate: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Effectiveness
              </label>
              <select
                value={trainingHistoryFilters.effectivenessRating}
                onChange={(e) =>
                  setTrainingHistoryFilters({ ...trainingHistoryFilters, effectivenessRating: e.target.value })
                }
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Ratings</option>
                <option value="Excellent">Excellent</option>
                <option value="Good">Good</option>
                <option value="Fair">Fair</option>
                <option value="Poor">Poor</option>
              </select>
            </div>
          </div>
        </div>

        {/* Training History Table */}
        {trainingHistoryLoading ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-12">
            <div className="text-center text-gray-500 dark:text-gray-400">Loading training history...</div>
          </div>
        ) : trainingRecords.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-12">
            <EmptyState
              icon={History}
              title="No Training History"
              description="No training records found matching your filters."
            />
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    {[
                      { key: "team_identifier" as const, label: "Team" },
                      { key: "issue_category" as const, label: "Issue Category" },
                      { key: "training_completed_date" as const, label: "Training Date" },
                      { key: "before_occurrence_count" as const, label: "Before" },
                      { key: "after_occurrence_count" as const, label: "After" },
                      { key: "occurrence_reduction_pct" as const, label: "Improvement %" },
                      { key: "effectiveness_rating" as const, label: "Effectiveness" },
                    ].map(({ key, label }) => (
                      <th
                        key={key}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                        onClick={() => {
                          if (trainingHistorySortColumn === key) {
                            setTrainingHistorySortDirection(
                              trainingHistorySortDirection === "asc" ? "desc" : "asc"
                            );
                          } else {
                            setTrainingHistorySortColumn(key);
                            setTrainingHistorySortDirection("desc");
                          }
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {label}
                          {trainingHistorySortColumn === key ? (
                            trainingHistorySortDirection === "asc" ? (
                              <ArrowUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            ) : (
                              <ArrowDown className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            )
                          ) : (
                            <ArrowUpDown className="h-4 w-4 text-gray-400" />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {[...trainingRecords]
                    .sort((a, b) => {
                      let aValue: string | number | null | undefined = a[trainingHistorySortColumn];
                      let bValue: string | number | null | undefined = b[trainingHistorySortColumn];

                      if (aValue === null || aValue === undefined) aValue = "";
                      if (bValue === null || bValue === undefined) bValue = "";

                      if (typeof aValue === "string" && typeof bValue === "string") {
                        return trainingHistorySortDirection === "asc"
                          ? aValue.localeCompare(bValue)
                          : bValue.localeCompare(aValue);
                      }

                      const aNum = typeof aValue === "number" ? aValue : 0;
                      const bNum = typeof bValue === "number" ? bValue : 0;

                      return trainingHistorySortDirection === "asc" ? aNum - bNum : bNum - aNum;
                    })
                    .map((record) => {
                      const getEffectivenessColor = (rating: string | null) => {
                        switch (rating) {
                          case "Excellent":
                            return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
                          case "Good":
                            return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
                          case "Fair":
                            return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
                          case "Poor":
                            return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
                          default:
                            return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
                        }
                      };

                      return (
                        <tr
                          key={record.id}
                          className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {record.team_identifier}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {record.issue_category}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {new Date(record.training_completed_date).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {record.before_occurrence_count ?? "N/A"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {record.after_occurrence_count ?? "N/A"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            {record.occurrence_reduction_pct !== null ? (
                              <span
                                className={
                                  record.occurrence_reduction_pct >= 0
                                    ? "text-green-600 dark:text-green-400 font-medium"
                                    : "text-red-600 dark:text-red-400 font-medium"
                                }
                              >
                                {record.occurrence_reduction_pct >= 0 ? "+" : ""}
                                {record.occurrence_reduction_pct.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-gray-500 dark:text-gray-400">Pending</span>
                            )}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {record.effectiveness_rating ? (
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getEffectivenessColor(
                                  record.effectiveness_rating
                                )}`}
                              >
                                {record.effectiveness_rating}
                              </span>
                            ) : (
                              <span className="text-gray-500 dark:text-gray-400 text-sm">Pending</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
