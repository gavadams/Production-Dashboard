"use client";

import { useState, useEffect, useCallback } from "react";
import { Calendar, TrendingUp, AlertCircle, Activity, Database } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { getDailyProduction, getTopDowntimeIssues, getPressTargets } from "@/lib/database";
import { determinePressStatus } from "@/lib/utils";
import { formatErrorMessage } from "@/lib/errorMessages";
import Link from "next/link";
import EmptyState from "@/components/EmptyState";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface PressData {
  press: string;
  status: "running" | "down" | "setup" | "no_work";
  productionTotal: number;
  avgRunSpeed: number;
  avgSpoilage: number;
  totalDowntime: number;
  efficiencyPct?: number;
  // Target comparison data
  targetRunSpeed?: number;
  targetEfficiencyPct?: number;
  targetSpoilagePct?: number;
  speedVariancePct?: number;
  efficiencyVariance?: number;
  spoilageVariance?: number;
}

const PRESS_CODES = ["LA01", "LA02", "LP03", "LP04", "LP05", "CL01"];

export default function DashboardPage() {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    // Default to today in YYYY-MM-DD format
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [pressData, setPressData] = useState<PressData[]>([]);
  const [topIssues, setTopIssues] = useState<Array<{
    category: string;
    total_minutes: number;
    presses: string[];
    occurrence_count: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Convert selectedDate (YYYY-MM-DD) to DD-MM-YYYY format for getDailyProduction
      const dateParts = selectedDate.split("-");
      const formattedDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

      // Fetch press targets for comparison
      const pressTargets = await getPressTargets();
      const targetsMap = new Map(pressTargets.map((t) => [t.press, t]));

      // Query daily production summary using the helper function
      const productionData = await getDailyProduction(formattedDate);

      // Query downtime events to calculate total downtime per press
      const { data: downtimeData, error: downtimeError } = await supabase
        .from("downtime_events")
        .select("press, minutes")
        .eq("date", selectedDate);

      if (downtimeError) {
        console.warn("Error fetching downtime data:", downtimeError);
      }

      // Calculate total downtime per press
      const downtimeByPress: Record<string, number> = {};
      if (downtimeData) {
        downtimeData.forEach((event) => {
          if (!downtimeByPress[event.press]) {
            downtimeByPress[event.press] = 0;
          }
          downtimeByPress[event.press] += event.minutes || 0;
        });
      }

      // Map data to PressData format
      const dataMap = new Map<string, PressData>();

      // Initialize all presses
      PRESS_CODES.forEach((press) => {
        dataMap.set(press, {
          press,
          status: "setup",
          productionTotal: 0,
          avgRunSpeed: 0,
          avgSpoilage: 0,
          totalDowntime: downtimeByPress[press] || 0,
          efficiencyPct: 0,
        });
      });

      // Update with actual data
      productionData.forEach((row) => {
        const totalDowntime = downtimeByPress[row.press] || 0;

        // Determine status using utility function
        const status = determinePressStatus({
          total_production: row.total_production || 0,
          efficiency_pct: row.efficiency_pct || 0,
          total_downtime_minutes: totalDowntime,
        });

        // Get target for this press
        const target = targetsMap.get(row.press);
        const actualRunSpeed = row.avg_run_speed || 0;
        const actualEfficiency = row.efficiency_pct || 0;
        const actualSpoilage = row.avg_spoilage_pct || 0;

        // Calculate variances
        let speedVariancePct: number | undefined;
        let efficiencyVariance: number | undefined;
        let spoilageVariance: number | undefined;

        if (target) {
          // Speed variance: (actual - target) / target * 100
          if (target.target_run_speed > 0) {
            speedVariancePct = ((actualRunSpeed - target.target_run_speed) / target.target_run_speed) * 100;
          }

          // Efficiency variance: actual - target
          efficiencyVariance = actualEfficiency - target.target_efficiency_pct;

          // Spoilage variance: actual - target
          spoilageVariance = actualSpoilage - target.target_spoilage_pct;
        }

        dataMap.set(row.press, {
          press: row.press,
          status,
          productionTotal: row.total_production || 0,
          avgRunSpeed: actualRunSpeed,
          avgSpoilage: actualSpoilage,
          totalDowntime,
          efficiencyPct: actualEfficiency,
          targetRunSpeed: target?.target_run_speed,
          targetEfficiencyPct: target?.target_efficiency_pct,
          targetSpoilagePct: target?.target_spoilage_pct,
          speedVariancePct,
          efficiencyVariance,
          spoilageVariance,
        });
      });

      setPressData(Array.from(dataMap.values()));

      // Fetch top downtime issues (formattedDate already defined above)
      const issues = await getTopDowntimeIssues(formattedDate, 5);
      setTopIssues(issues);
    } catch (err) {
      console.error("Error fetching dashboard data:", err);
      const errorMsg = formatErrorMessage(err);
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const getStatusColor = (status: PressData["status"]) => {
    switch (status) {
      case "running":
        return "bg-green-500";
      case "down":
        return "bg-red-500";
      case "setup":
        return "bg-yellow-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusLabel = (status: PressData["status"]) => {
    switch (status) {
      case "running":
        return "Running";
      case "down":
        return "Down";
      case "setup":
        return "Setup";
      default:
        return "Unknown";
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  // Helper function to get variance color
  const getVarianceColor = (variancePct: number | undefined, isSpoilage: boolean = false): string => {
    if (variancePct === undefined) return "text-gray-600 dark:text-gray-400";
    
    // For spoilage, lower is better (negative variance is good)
    // For speed/efficiency, higher is better (positive variance is good)
    const isGood = isSpoilage ? variancePct <= 0 : variancePct >= 0;
    const isWithinThreshold = Math.abs(variancePct) <= 10;

    if (isGood && isWithinThreshold) {
      return "text-green-600 dark:text-green-400";
    } else if (isWithinThreshold) {
      return "text-yellow-600 dark:text-yellow-400";
    } else {
      return "text-red-600 dark:text-red-400";
    }
  };

  // Helper function to format variance text
  const formatVarianceText = (
    actual: number,
    variancePct: number | undefined,
    unit: string,
    decimals: number = 1
  ): string => {
    if (variancePct === undefined) {
      return `${actual.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${unit}`;
    }

    const sign = variancePct >= 0 ? "+" : "";
    const arrow = variancePct >= 0 ? "↑" : "↓";
    return `${actual.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${unit} (${sign}${variancePct.toFixed(1)}% vs target) ${arrow}`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Dashboard</h1>

        {/* Date Selector */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
          <label htmlFor="date-selector" className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
            <Calendar className="h-5 w-5" />
            Select Date:
          </label>
          <input
            id="date-selector"
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full sm:w-auto px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {formatDate(selectedDate)}
          </span>
        </div>
      </div>

      {/* Loading State - Skeleton Loaders */}
      {loading && (
        <div className="space-y-6 animate-pulse">
          {/* Press Cards Skeleton */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {PRESS_CODES.map((press) => (
              <div
                key={press}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="h-6 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-4 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
                </div>
                <div className="space-y-3">
                  <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-36 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
              </div>
            ))}
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
          
          {/* Top Issues Skeleton */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
            <div className="h-6 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-5 w-5 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 flex-1 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        </div>
      )}

      {/* Press Cards Grid */}
      {!loading && !error && (
        <>
          {pressData.length === 0 || pressData.every((p) => p.productionTotal === 0) ? (
            <EmptyState
              icon={Database}
              title="No Production Data Available"
              description={`No production data found for ${formatDate(selectedDate)}. Upload production reports to see dashboard metrics.`}
              action={{
                label: "Upload Data",
                onClick: () => {
                  window.location.href = "/upload";
                },
              }}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {pressData.map((press) => (
            <div
              key={press.press}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg transition-shadow"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {press.press}
                </h2>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${getStatusColor(press.status)}`}
                    title={getStatusLabel(press.status)}
                  />
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    {getStatusLabel(press.status)}
                  </span>
                </div>
              </div>

              {/* Metrics */}
              <div className="space-y-4">
                {/* Production Total */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <Activity className="h-4 w-4" />
                    <span className="text-sm">Production</span>
                  </div>
                  <span className="text-lg font-semibold text-gray-900 dark:text-white">
                    {press.productionTotal.toLocaleString()}
                  </span>
                </div>

                {/* Run Speed with Target Comparison */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <TrendingUp className="h-4 w-4" />
                    <span className="text-sm">Avg Run Speed</span>
                  </div>
                  <div className="text-right">
                    <span className={`text-lg font-semibold ${getVarianceColor(press.speedVariancePct)}`}>
                      {formatVarianceText(press.avgRunSpeed, press.speedVariancePct, "/hr", 1)}
                    </span>
                    {press.targetRunSpeed && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Target: {press.targetRunSpeed.toLocaleString()} /hr
                      </div>
                    )}
                  </div>
                </div>

                {/* Efficiency with Target Comparison */}
                {press.efficiencyPct !== undefined && press.efficiencyPct > 0 && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                      <Activity className="h-4 w-4" />
                      <span className="text-sm">Efficiency</span>
                    </div>
                    <div className="text-right">
                      {press.efficiencyVariance !== undefined ? (
                        <>
                          <span className={`text-lg font-semibold ${getVarianceColor(press.efficiencyVariance)}`}>
                            {press.efficiencyPct.toFixed(1)}%
                            {press.efficiencyVariance >= 0 ? " ↑" : " ↓"}
                            <span className="text-xs ml-1">
                              ({press.efficiencyVariance >= 0 ? "+" : ""}{press.efficiencyVariance.toFixed(1)}% vs target)
                            </span>
                          </span>
                          {press.targetEfficiencyPct && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              Target: {press.targetEfficiencyPct.toFixed(1)}%
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-lg font-semibold text-gray-900 dark:text-white">
                          {press.efficiencyPct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Spoilage with Target Comparison */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm">Spoilage %</span>
                  </div>
                  <div className="text-right">
                    {press.spoilageVariance !== undefined ? (
                      <>
                        <span className={`text-lg font-semibold ${getVarianceColor(press.spoilageVariance, true)}`}>
                          {press.avgSpoilage.toFixed(2)}%
                          {press.spoilageVariance <= 0 ? " ↓" : " ↑"}
                          <span className="text-xs ml-1">
                            ({press.spoilageVariance >= 0 ? "+" : ""}{press.spoilageVariance.toFixed(2)}% vs target)
                          </span>
                        </span>
                        {press.targetSpoilagePct && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            Target: {press.targetSpoilagePct.toFixed(2)}%
                          </div>
                        )}
                      </>
                    ) : (
                      <span
                        className={`text-lg font-semibold ${
                          press.avgSpoilage > 2
                            ? "text-red-600 dark:text-red-400"
                            : press.avgSpoilage > 1
                            ? "text-yellow-600 dark:text-yellow-400"
                            : "text-gray-900 dark:text-white"
                        }`}
                      >
                        {press.avgSpoilage.toFixed(2)}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Downtime */}
                {press.totalDowntime > 0 && (
                  <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600 dark:text-gray-400">Downtime</span>
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {Math.floor(press.totalDowntime / 60)}h {press.totalDowntime % 60}m
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
          )}
        </>
      )}

      {/* Charts Section */}
      {!loading && !error && pressData.some((p) => p.productionTotal > 0) && (
        <div className="mt-12 space-y-8">
          {/* Total Production Bar Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Total Production by Press
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={pressData
                  .filter((p) => p.productionTotal > 0)
                  .map((p) => ({
                    press: p.press,
                    production: p.productionTotal,
                  }))}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                <XAxis
                  dataKey="press"
                  stroke="#6b7280"
                  className="dark:stroke-gray-400"
                  tick={{ fill: "#6b7280" }}
                />
                <YAxis
                  stroke="#6b7280"
                  className="dark:stroke-gray-400"
                  tick={{ fill: "#6b7280" }}
                  label={{
                    value: "Production Units",
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
                  formatter={(value: number) => [
                    value.toLocaleString(),
                    "Production",
                  ]}
                />
                <Bar
                  dataKey="production"
                  fill="#3b82f6"
                  radius={[8, 8, 0, 0]}
                  name="Production"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Downtime Horizontal Bar Chart */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Downtime by Press (Hours)
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                layout="vertical"
                data={pressData
                  .filter((p) => p.totalDowntime > 0)
                  .map((p) => ({
                    press: p.press,
                    downtime: Math.round((p.totalDowntime / 60) * 10) / 10, // Convert to hours with 1 decimal
                  }))}
                margin={{ top: 20, right: 30, left: 60, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                <XAxis
                  type="number"
                  stroke="#6b7280"
                  className="dark:stroke-gray-400"
                  tick={{ fill: "#6b7280" }}
                  label={{
                    value: "Hours",
                    position: "insideBottom",
                    offset: -5,
                    style: { textAnchor: "middle", fill: "#6b7280" },
                  }}
                />
                <YAxis
                  type="category"
                  dataKey="press"
                  stroke="#6b7280"
                  className="dark:stroke-gray-400"
                  tick={{ fill: "#6b7280" }}
                  width={50}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [
                    `${value.toFixed(1)} hours`,
                    "Downtime",
                  ]}
                />
                <Bar
                  dataKey="downtime"
                  fill="#ef4444"
                  radius={[0, 8, 8, 0]}
                  name="Downtime"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Top Issues Today Section */}
      {!loading && !error && topIssues.length > 0 && (
        <div className="mt-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              Top Issues Today
            </h2>
            <Link
              href="/maintenance"
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
            >
              View All →
            </Link>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
            <div className="space-y-4">
              {topIssues.map((issue, index) => {
                const hours = Math.floor(issue.total_minutes / 60);
                const minutes = issue.total_minutes % 60;
                const getIcon = () => {
                  if (issue.total_minutes > 60) return "🚨";
                  if (issue.total_minutes > 30) return "⚠️";
                  return "ℹ️";
                };

                return (
                  <Link
                    key={`${issue.category}-${index}`}
                    href={`/maintenance?category=${encodeURIComponent(issue.category)}&date=${selectedDate}`}
                    className="block p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-2xl">{getIcon()}</span>
                          <h3 className="font-semibold text-gray-900 dark:text-white">
                            {issue.category}
                          </h3>
                        </div>
                        <div className="ml-11 space-y-1">
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            <span className="font-medium">
                              {hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`}
                            </span>{" "}
                            total downtime
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Affected presses:{" "}
                            <span className="font-medium text-gray-900 dark:text-white">
                              {issue.presses.join(", ")}
                            </span>
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-500">
                            {issue.occurrence_count} occurrence{issue.occurrence_count !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>
                      <div className="ml-4 text-gray-400 dark:text-gray-500">
                        →
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && pressData.every((p) => p.productionTotal === 0) && (
        <div className="text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">
            No production data available for {formatDate(selectedDate)}
          </p>
        </div>
      )}
    </div>
  );
}

