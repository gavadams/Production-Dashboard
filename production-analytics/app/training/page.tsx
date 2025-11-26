"use client";

import { useState, useEffect, useCallback } from "react";
import { Filter, ArrowUpDown, ArrowUp, ArrowDown, GraduationCap, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, X, CheckCircle, AlertCircle, RefreshCw, History, Target } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { getTeamTrainingNeeds, getTrainingRecommendationFromDB, getRecurringIssues, getTrainingRecords, updateTrainingEffectiveness } from "@/lib/database";
import type { TeamTrainingNeed, TrainingRecommendation, RecurringIssue, TrainingRecord } from "@/lib/database";
import { formatErrorMessage } from "@/lib/errorMessages";
import { calculateTrainingPriority } from "@/lib/utils";
import EmptyState from "@/components/EmptyState";
import ComparisonChart from "@/components/ComparisonChart";
import MarkTrainingCompletedModal from "@/components/MarkTrainingCompletedModal";

const DATE_RANGES = [
  { label: "Last 7 days", value: 7 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
];

export default function TrainingPage() {
  const [selectedDaysBack, setSelectedDaysBack] = useState<number>(30);
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
    effectivenessRating: "Excellent" | "Good" | "Fair" | "Poor" | "";
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

  const fetchTrainingData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
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
          // TODO: Commented out until accurate cost calculation system is implemented
          // const estimatedCost: number | undefined = need.issue_type === "Spoilage"
          //   ? need.total_impact * 0.10 // £0.10 per unit
          //   : (need.total_impact / 60) * 50; // £50 per hour
          const estimatedCost: number | undefined = undefined;

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
      console.error("Error fetching training data:", err);
      const errorMsg = formatErrorMessage(err);
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [selectedDaysBack]);

  const fetchTrainingRecords = useCallback(async () => {
    setTrainingHistoryLoading(true);
    try {
      const records = await getTrainingRecords({
        teamIdentifier: trainingHistoryFilters.teamIdentifier || undefined,
        issueCategory: trainingHistoryFilters.issueCategory || undefined,
        startDate: trainingHistoryFilters.startDate || undefined,
        endDate: trainingHistoryFilters.endDate || undefined,
        effectivenessRating: trainingHistoryFilters.effectivenessRating 
          ? (trainingHistoryFilters.effectivenessRating as "Excellent" | "Good" | "Fair" | "Poor")
          : undefined,
      });
      setTrainingRecords(records);
    } catch (err) {
      console.error("Error fetching training records:", err);
      toast.error("Failed to fetch training records");
    } finally {
      setTrainingHistoryLoading(false);
    }
  }, [trainingHistoryFilters]);

  useEffect(() => {
    fetchTrainingData();
  }, [fetchTrainingData]);

  useEffect(() => {
    fetchTrainingRecords();
  }, [fetchTrainingRecords]);

  const handleIgnoreIssue = async (category: string, issueType: "downtime" | "spoilage", press: string) => {
    try {
      const { error } = await supabase
        .from("ignored_issue_categories")
        .insert({
          category,
          issue_type: issueType,
          press: press || null,
          ignored_by: "System",
          reason: "Ignored from training recommendations",
        });

      if (error) {
        if (error.code === "23505") {
          toast.success("This issue is already ignored");
        } else {
          throw error;
        }
      } else {
        toast.success("Issue ignored successfully");
        fetchTrainingData();
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
    await fetchTrainingData();
    await fetchTrainingRecords();
  };

  const handleRefreshEffectiveness = async () => {
    setRefreshingEffectiveness(true);
    try {
      const summary = await updateTrainingEffectiveness();
      toast.success(`Updated ${summary.recordsProcessed} training record(s)`);
      await fetchTrainingRecords();
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
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Training & Development</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Identify training opportunities and track training effectiveness
        </p>
      </div>

      {/* Date Range Filter */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Time Period</h2>
        </div>
        <div className="max-w-xs">
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

      {/* Loading State */}
      {loading && (
        <div className="space-y-6 animate-pulse">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
            <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
              ))}
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
                  const newExpanded = new Set(expandedCards);
                  newExpanded.add(cardId);
                  setExpandedCards(newExpanded);

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
                      {/* TODO: Cost display commented out until accurate cost calculation system is implemented */}
                      {/* {need.estimatedCost !== undefined && need.estimatedCost > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-600 dark:text-gray-400">Est. Cost:</span>
                          <span className="font-semibold text-red-600 dark:text-red-400">
                            £{need.estimatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )} */}
                    </div>

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
                const aScore = a.priorityScore || a.recurringIssue?.priority_score || a.occurrence_count;
                const bScore = b.priorityScore || b.recurringIssue?.priority_score || b.occurrence_count;
                return bScore - aScore;
              })
              .map((need, index) => {
                const cardId = `${need.team_identifier}-${need.issue_category}-${index}`;
                const isExpanded = expandedCards.has(cardId);
                const recurringIssue = need.recurringIssue;
                const trainingRec = need.trainingRecommendation;

                const priority = need.priorityLevel || trainingRec?.priority || "Medium";
                const priorityColors = {
                  Critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-300 dark:border-red-700",
                  High: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-orange-300 dark:border-orange-700",
                  Medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700",
                  Low: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-300 dark:border-green-700",
                };

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

                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-4 border-t border-gray-200 dark:border-gray-700">
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

                        {/* TODO: Cost display commented out until accurate cost calculation system is implemented */}
                        {/* {need.estimatedCost !== undefined && need.estimatedCost > 0 && (
                          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                            <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Cost Impact</h4>
                            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                              <div className="text-sm font-semibold text-red-700 dark:text-red-300">
                                Estimated cost: £{need.estimatedCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in waste
                              </div>
                            </div>
                          </div>
                        )} */}

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

      {!loading && !error && enhancedTrainingNeeds.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-12">
          <EmptyState
            icon={GraduationCap}
            title="No Training Needs Found"
            description="No training opportunities match your current filters. Try adjusting the time period to see results."
          />
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
                  setTrainingHistoryFilters({ 
                    ...trainingHistoryFilters, 
                    effectivenessRating: e.target.value as "Excellent" | "Good" | "Fair" | "Poor" | ""
                  })
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

