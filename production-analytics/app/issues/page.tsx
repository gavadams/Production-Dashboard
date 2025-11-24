"use client";

import { useState, useCallback, useEffect } from "react";
import { AlertTriangle, TrendingUp, TrendingDown, Minus, Eye, X, XCircle } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { formatErrorMessage } from "@/lib/errorMessages";

const PRESS_CODES = ["LA01", "LA02", "LP03", "LP04", "LP05", "CL01"];

interface RecurringIssue {
  category: string;
  occurrences: number;
  totalImpact: number;
  affectedPresses: string[];
  mostAffectedTeam: string | null;
  trend: "increasing" | "stable" | "decreasing";
  previousPeriodCount: number;
}

interface IgnoreModalData {
  category: string;
  type: "downtime" | "spoilage";
}

interface InvestigationData {
  category: string;
  type: "downtime" | "spoilage";
  occurrences: Array<{
    date: string;
    press: string;
    shift: string | null;
    team: string | null;
    work_order: string | null;
    impact: number;
    comments: string | null;
  }>;
  teamBreakdown: Array<{
    team: string;
    count: number;
    totalImpact: number;
  }>;
  shiftPattern: {
    mostCommon: string | null;
    breakdown: Array<{ shift: string; count: number }>;
  };
  relatedIssues: Array<{
    category: string;
    coOccurrenceCount: number;
  }>;
}

export default function IssuesPage() {
  const [timeRange, setTimeRange] = useState<number>(30);
  const [selectedPress, setSelectedPress] = useState<string>("all");
  const [downtimeIssues, setDowntimeIssues] = useState<RecurringIssue[]>([]);
  const [spoilageIssues, setSpoilageIssues] = useState<RecurringIssue[]>([]);
  const [ignoredDowntimeIssues, setIgnoredDowntimeIssues] = useState<RecurringIssue[]>([]);
  const [ignoredSpoilageIssues, setIgnoredSpoilageIssues] = useState<RecurringIssue[]>([]);
  const [showIgnored, setShowIgnored] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ignoreModal, setIgnoreModal] = useState<IgnoreModalData | null>(null);
  const [ignoreForAllPresses, setIgnoreForAllPresses] = useState<boolean>(true);
  const [ignoreReason, setIgnoreReason] = useState<string>("");
  const [investigationData, setInvestigationData] = useState<InvestigationData | null>(null);
  const [investigationLoading, setInvestigationLoading] = useState<boolean>(false);

  const fetchRecurringIssues = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - timeRange);

      // Previous period for trend calculation
      const previousEndDate = new Date(startDate);
      previousEndDate.setDate(previousEndDate.getDate() - 1);
      const previousStartDate = new Date(previousEndDate);
      previousStartDate.setDate(previousStartDate.getDate() - timeRange);

      const endDateStr = endDate.toISOString().split("T")[0];
      const startDateStr = startDate.toISOString().split("T")[0];
      const previousEndDateStr = previousEndDate.toISOString().split("T")[0];
      const previousStartDateStr = previousStartDate.toISOString().split("T")[0];

      // Fetch ignored categories
      let ignoredQuery = supabase
        .from("ignored_issue_categories")
        .select("category, issue_type, press")
        .eq("issue_type", "downtime")
        .or(`press.is.null,press.eq.${selectedPress === "all" ? "" : selectedPress}`);

      if (selectedPress !== "all") {
        ignoredQuery = ignoredQuery.or(`press.is.null,press.eq.${selectedPress}`);
      }

      const { data: ignoredDowntime } = await ignoredQuery;

      // Also fetch ignored spoilage categories
      let ignoredSpoilageQuery = supabase
        .from("ignored_issue_categories")
        .select("category, issue_type, press")
        .eq("issue_type", "spoilage")
        .or(`press.is.null,press.eq.${selectedPress === "all" ? "" : selectedPress}`);

      if (selectedPress !== "all") {
        ignoredSpoilageQuery = ignoredSpoilageQuery.or(`press.is.null,press.eq.${selectedPress}`);
      }

      const { data: ignoredSpoilage } = await ignoredSpoilageQuery;

      // Create sets of ignored categories
      const ignoredDowntimeSet = new Set<string>();
      if (ignoredDowntime) {
        ignoredDowntime.forEach((item) => {
          if (!item.press || item.press === selectedPress || selectedPress === "all") {
            ignoredDowntimeSet.add(item.category);
          }
        });
      }

      const ignoredSpoilageSet = new Set<string>();
      if (ignoredSpoilage) {
        ignoredSpoilage.forEach((item) => {
          if (!item.press || item.press === selectedPress || selectedPress === "all") {
            ignoredSpoilageSet.add(item.category);
          }
        });
      }

      // Fetch downtime events
      let downtimeQuery = supabase
        .from("downtime_events")
        .select("category, minutes, press, team, date")
        .gte("date", startDateStr)
        .lte("date", endDateStr);

      if (selectedPress !== "all") {
        downtimeQuery = downtimeQuery.eq("press", selectedPress);
      }

      const { data: downtimeData, error: downtimeError } = await downtimeQuery;

      if (downtimeError) {
        throw downtimeError;
      }

      // Fetch previous period downtime for trend
      let previousDowntimeQuery = supabase
        .from("downtime_events")
        .select("category, press")
        .gte("date", previousStartDateStr)
        .lte("date", previousEndDateStr);

      if (selectedPress !== "all") {
        previousDowntimeQuery = previousDowntimeQuery.eq("press", selectedPress);
      }

      const { data: previousDowntimeData } = await previousDowntimeQuery;

      // Fetch spoilage events
      let spoilageQuery = supabase
        .from("spoilage_events")
        .select("category, units, press, team, date")
        .gte("date", startDateStr)
        .lte("date", endDateStr);

      if (selectedPress !== "all") {
        spoilageQuery = spoilageQuery.eq("press", selectedPress);
      }

      const { data: spoilageData, error: spoilageError } = await spoilageQuery;

      if (spoilageError) {
        throw spoilageError;
      }

      // Fetch previous period spoilage for trend
      let previousSpoilageQuery = supabase
        .from("spoilage_events")
        .select("category, press")
        .gte("date", previousStartDateStr)
        .lte("date", previousEndDateStr);

      if (selectedPress !== "all") {
        previousSpoilageQuery = previousSpoilageQuery.eq("press", selectedPress);
      }

      const { data: previousSpoilageData } = await previousSpoilageQuery;

      // Process downtime issues
      const downtimeMap = new Map<
        string,
        {
          occurrences: number;
          totalImpact: number;
          presses: Set<string>;
          teams: Map<string, number>;
        }
      >();

      if (downtimeData) {
        downtimeData.forEach((event) => {
          const category = event.category || "Unknown";
          
          // Skip ignored categories
          if (ignoredDowntimeSet.has(category)) {
            return;
          }

          const existing = downtimeMap.get(category) || {
            occurrences: 0,
            totalImpact: 0,
            presses: new Set<string>(),
            teams: new Map<string, number>(),
          };

          downtimeMap.set(category, {
            occurrences: existing.occurrences + 1,
            totalImpact: existing.totalImpact + (event.minutes || 0),
            presses: existing.presses.add(event.press || ""),
            teams: (() => {
              const team = event.team || "";
              if (team) {
                const count = existing.teams.get(team) || 0;
                existing.teams.set(team, count + 1);
              }
              return existing.teams;
            })(),
          });
        });
      }

      // Process previous period downtime for trends
      const previousDowntimeMap = new Map<string, number>();
      if (previousDowntimeData) {
        previousDowntimeData.forEach((event) => {
          const category = event.category || "Unknown";
          previousDowntimeMap.set(category, (previousDowntimeMap.get(category) || 0) + 1);
        });
      }

      // Convert downtime map to array
      const downtimeIssuesArray: RecurringIssue[] = Array.from(downtimeMap.entries())
        .map(([category, data]) => {
          const previousCount = previousDowntimeMap.get(category) || 0;
          const currentCount = data.occurrences;
          let trend: "increasing" | "stable" | "decreasing";

          if (previousCount === 0) {
            trend = currentCount > 0 ? "increasing" : "stable";
          } else {
            const change = ((currentCount - previousCount) / previousCount) * 100;
            if (change > 10) {
              trend = "increasing";
            } else if (change < -10) {
              trend = "decreasing";
            } else {
              trend = "stable";
            }
          }

          // Find most affected team
          let mostAffectedTeam: string | null = null;
          let maxTeamCount = 0;
          data.teams.forEach((count, team) => {
            if (count > maxTeamCount) {
              maxTeamCount = count;
              mostAffectedTeam = team;
            }
          });

          return {
            category,
            occurrences: currentCount,
            totalImpact: data.totalImpact,
            affectedPresses: Array.from(data.presses).filter((p) => p),
            mostAffectedTeam,
            trend,
            previousPeriodCount: previousCount,
          };
        })
        .sort((a, b) => b.occurrences - a.occurrences);

      // Process spoilage issues
      const spoilageMap = new Map<
        string,
        {
          occurrences: number;
          totalImpact: number;
          presses: Set<string>;
          teams: Map<string, number>;
        }
      >();

      if (spoilageData) {
        spoilageData.forEach((event) => {
          const category = event.category || "Unknown";
          
          // Skip ignored categories
          if (ignoredSpoilageSet.has(category)) {
            return;
          }

          const existing = spoilageMap.get(category) || {
            occurrences: 0,
            totalImpact: 0,
            presses: new Set<string>(),
            teams: new Map<string, number>(),
          };

          spoilageMap.set(category, {
            occurrences: existing.occurrences + 1,
            totalImpact: existing.totalImpact + (event.units || 0),
            presses: existing.presses.add(event.press || ""),
            teams: (() => {
              const team = event.team || "";
              if (team) {
                const count = existing.teams.get(team) || 0;
                existing.teams.set(team, count + 1);
              }
              return existing.teams;
            })(),
          });
        });
      }

      // Process previous period spoilage for trends
      const previousSpoilageMap = new Map<string, number>();
      if (previousSpoilageData) {
        previousSpoilageData.forEach((event) => {
          const category = event.category || "Unknown";
          previousSpoilageMap.set(category, (previousSpoilageMap.get(category) || 0) + 1);
        });
      }

      // Convert spoilage map to array
      const spoilageIssuesArray: RecurringIssue[] = Array.from(spoilageMap.entries())
        .map(([category, data]) => {
          const previousCount = previousSpoilageMap.get(category) || 0;
          const currentCount = data.occurrences;
          let trend: "increasing" | "stable" | "decreasing";

          if (previousCount === 0) {
            trend = currentCount > 0 ? "increasing" : "stable";
          } else {
            const change = ((currentCount - previousCount) / previousCount) * 100;
            if (change > 10) {
              trend = "increasing";
            } else if (change < -10) {
              trend = "decreasing";
            } else {
              trend = "stable";
            }
          }

          // Find most affected team
          let mostAffectedTeam: string | null = null;
          let maxTeamCount = 0;
          data.teams.forEach((count, team) => {
            if (count > maxTeamCount) {
              maxTeamCount = count;
              mostAffectedTeam = team;
            }
          });

          return {
            category,
            occurrences: currentCount,
            totalImpact: data.totalImpact,
            affectedPresses: Array.from(data.presses).filter((p) => p),
            mostAffectedTeam,
            trend,
            previousPeriodCount: previousCount,
          };
        })
        .sort((a, b) => b.occurrences - a.occurrences);

      setDowntimeIssues(downtimeIssuesArray);
      setSpoilageIssues(spoilageIssuesArray);
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      setError(errorMsg);
      toast.error(errorMsg);
      console.error("Error fetching recurring issues:", err);
    } finally {
      setLoading(false);
    }
  }, [timeRange, selectedPress]);

  useEffect(() => {
    fetchRecurringIssues();
  }, [fetchRecurringIssues]);

  const handleIgnore = async (category: string, type: "downtime" | "spoilage") => {
    try {
      const { error } = await supabase.from("ignored_issue_categories").insert({
        category,
        issue_type: type,
        press: selectedPress === "all" ? null : selectedPress,
        ignored_by: "User", // TODO: Get actual user from auth
        reason: "Marked as normal process issue",
      });

      if (error) {
        // Handle unique constraint violation (already ignored)
        if (error.code === "23505") {
          toast.error("This category is already ignored");
        } else {
          throw error;
        }
      } else {
        toast.success(`${type === "downtime" ? "Downtime" : "Spoilage"} issue "${category}" marked as ignored`);
        // Refresh the issues list to exclude ignored categories
        fetchRecurringIssues();
      }
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      toast.error(`Failed to ignore issue: ${errorMsg}`);
      console.error("Error ignoring issue:", err);
    }
  };

  const handleInvestigate = async (category: string, type: "downtime" | "spoilage") => {
    setInvestigationLoading(true);
    setInvestigationData(null);

    try {
      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - timeRange);

      const endDateStr = endDate.toISOString().split("T")[0];
      const startDateStr = startDate.toISOString().split("T")[0];

      // Determine which table to query
      const tableName = type === "downtime" ? "downtime_events" : "spoilage_events";
      const impactField = type === "downtime" ? "minutes" : "units";

      // Build query for this specific category
      let query = supabase
        .from(tableName)
        .select(`date, press, shift, team, work_order, ${impactField}, comments, production_run_id`)
        .eq("category", category)
        .gte("date", startDateStr)
        .lte("date", endDateStr)
        .order("date", { ascending: false });

      if (selectedPress !== "all") {
        query = query.eq("press", selectedPress);
      }

      const { data: events, error } = await query;

      if (error) {
        throw error;
      }

      if (!events || events.length === 0) {
        toast.error("No occurrences found for this category");
        return;
      }

      // Get production run details for work orders
      const productionRunIds = events
        .map((e) => e.production_run_id)
        .filter((id): id is string => id !== null && id !== undefined);

      let workOrdersMap = new Map<string, string | null>();
      if (productionRunIds.length > 0) {
        const { data: productionRuns } = await supabase
          .from("production_runs")
          .select("id, work_order")
          .in("id", productionRunIds);

        if (productionRuns) {
          productionRuns.forEach((run) => {
            workOrdersMap.set(run.id, run.work_order);
          });
        }
      }

      // Process occurrences
      const occurrences = events.map((event) => ({
        date: event.date || "",
        press: event.press || "",
        shift: event.shift || null,
        team: event.team || null,
        work_order: workOrdersMap.get(event.production_run_id || "") || event.work_order || null,
        impact: (event[impactField] as number) || 0,
        comments: event.comments || null,
      }));

      // Team breakdown
      const teamMap = new Map<string, { count: number; totalImpact: number }>();
      occurrences.forEach((occ) => {
        if (occ.team) {
          const existing = teamMap.get(occ.team) || { count: 0, totalImpact: 0 };
          teamMap.set(occ.team, {
            count: existing.count + 1,
            totalImpact: existing.totalImpact + occ.impact,
          });
        }
      });

      const teamBreakdown = Array.from(teamMap.entries())
        .map(([team, data]) => ({
          team,
          count: data.count,
          totalImpact: data.totalImpact,
        }))
        .sort((a, b) => b.count - a.count);

      // Shift pattern analysis
      const shiftMap = new Map<string, number>();
      occurrences.forEach((occ) => {
        if (occ.shift) {
          shiftMap.set(occ.shift, (shiftMap.get(occ.shift) || 0) + 1);
        }
      });

      const shiftBreakdown = Array.from(shiftMap.entries())
        .map(([shift, count]) => ({ shift, count }))
        .sort((a, b) => b.count - a.count);

      const mostCommonShift = shiftBreakdown.length > 0 ? shiftBreakdown[0].shift : null;

      // Related issues analysis - find categories that occur on same production runs
      const relatedIssuesMap = new Map<string, number>();
      if (productionRunIds.length > 0) {
        // Get all events for the same production runs
        const relatedTableName = type === "downtime" ? "spoilage_events" : "downtime_events";
        const { data: relatedEvents } = await supabase
          .from(relatedTableName)
          .select("category, production_run_id")
          .in("production_run_id", productionRunIds)
          .neq("category", category);

        if (relatedEvents) {
          relatedEvents.forEach((event) => {
            const cat = event.category || "Unknown";
            relatedIssuesMap.set(cat, (relatedIssuesMap.get(cat) || 0) + 1);
          });
        }

        // Also check same-type events on same runs (different categories)
        const { data: sameTypeEvents } = await supabase
          .from(tableName)
          .select("category, production_run_id")
          .in("production_run_id", productionRunIds)
          .neq("category", category);

        if (sameTypeEvents) {
          sameTypeEvents.forEach((event) => {
            const cat = event.category || "Unknown";
            relatedIssuesMap.set(cat, (relatedIssuesMap.get(cat) || 0) + 1);
          });
        }
      }

      const relatedIssues = Array.from(relatedIssuesMap.entries())
        .map(([category, count]) => ({ category, coOccurrenceCount: count }))
        .sort((a, b) => b.coOccurrenceCount - a.coOccurrenceCount)
        .slice(0, 5);

      setInvestigationData({
        category,
        type,
        occurrences,
        teamBreakdown,
        shiftPattern: {
          mostCommon: mostCommonShift,
          breakdown: shiftBreakdown,
        },
        relatedIssues,
      });
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      toast.error(`Failed to load investigation data: ${errorMsg}`);
      console.error("Error investigating issue:", err);
    } finally {
      setInvestigationLoading(false);
    }
  };

  const getTrendIcon = (trend: "increasing" | "stable" | "decreasing") => {
    switch (trend) {
      case "increasing":
        return <TrendingUp className="h-4 w-4 text-red-600 dark:text-red-400" />;
      case "decreasing":
        return <TrendingDown className="h-4 w-4 text-green-600 dark:text-green-400" />;
      case "stable":
        return <Minus className="h-4 w-4 text-gray-600 dark:text-gray-400" />;
    }
  };

  const renderIssuesTable = (
    issues: RecurringIssue[],
    type: "downtime" | "spoilage",
    impactLabel: string
  ) => {
    if (allIssues.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          No recurring {type} issues found for the selected filters.
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Issue Category
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Occurrences
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Total Impact ({impactLabel})
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Affected Presses
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Most Affected Team
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Trend
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
            {allIssues.map((issue, index) => {
              const isIgnored = ignoredIssues.some((ignored) => ignored.category === issue.category);
              return (
                <tr
                  key={`${type}-${issue.category}-${index}`}
                  className={`hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                    issue.occurrences > 5 && !isIgnored ? "bg-yellow-50 dark:bg-yellow-900/20" : ""
                  } ${isIgnored ? "opacity-60" : ""}`}
                >
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                  {isIgnored ? (
                    <span className="line-through text-gray-500 dark:text-gray-400">{issue.category}</span>
                  ) : (
                    issue.category
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {issue.occurrences}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {type === "downtime"
                    ? `${Math.floor(issue.totalImpact / 60)}h ${issue.totalImpact % 60}m`
                    : issue.totalImpact.toLocaleString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {issue.affectedPresses.length > 0 ? issue.affectedPresses.join(", ") : "N/A"}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  {issue.mostAffectedTeam || "N/A"}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  <div className="flex items-center gap-1">{getTrendIcon(issue.trend)}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleInvestigate(issue.category, type)}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded transition-colors flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" />
                      Investigate
                    </button>
                    <button
                      onClick={() => handleIgnore(issue.category, type)}
                      className="px-3 py-1 bg-gray-600 hover:bg-gray-700 text-white text-xs rounded transition-colors flex items-center gap-1"
                    >
                      <X className="h-3 w-3" />
                      Ignore
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <AlertTriangle className="h-8 w-8 text-orange-600 dark:text-orange-400" />
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Recurring Issues</h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Identify and track recurring downtime and spoilage issues across production lines
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="time-range" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Time Range
            </label>
            <select
              id="time-range"
              value={timeRange}
              onChange={(e) => setTimeRange(Number(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
            </select>
          </div>
          <div>
            <label htmlFor="press-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Press Filter
            </label>
            <select
              id="press-filter"
              value={selectedPress}
              onChange={(e) => setSelectedPress(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Presses</option>
              {PRESS_CODES.map((press) => (
                <option key={press} value={press}>
                  {press}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showIgnored}
                onChange={(e) => setShowIgnored(e.target.checked)}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Show Ignored Issues</span>
            </label>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="mb-6 text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-400">Loading issues...</p>
        </div>
      )}

      {/* Recurring Downtime Issues */}
      {!loading && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            Recurring Downtime Issues
          </h2>
          {renderIssuesTable(downtimeIssues, ignoredDowntimeIssues, "downtime", "minutes")}
        </div>
      )}

      {/* Recurring Spoilage Issues */}
      {!loading && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            Recurring Spoilage Issues
          </h2>
          {renderIssuesTable(spoilageIssues, ignoredSpoilageIssues, "spoilage", "units")}
        </div>
      )}
    </div>
  );
}

