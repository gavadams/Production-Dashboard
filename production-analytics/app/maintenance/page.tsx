"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, AlertCircle, Info, Filter, X } from "lucide-react";
import { getMaintenanceAlerts, getWeeklyDowntimeData } from "@/lib/database";
import type { MaintenanceAlert, WeeklyDowntimeData } from "@/lib/database";
import {
  LineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";

const PRESS_CODES = ["LA01", "LA02", "LP03", "LP04", "LP05", "CL01"];

export default function MaintenancePage() {
  const [selectedPress, setSelectedPress] = useState<string>("");
  const [alerts, setAlerts] = useState<MaintenanceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Chart state
  const [selectedCategory, setSelectedCategory] = useState<{ press: string; category: string } | null>(null);
  const [weeklyData, setWeeklyData] = useState<WeeklyDowntimeData[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getMaintenanceAlerts({
        press: selectedPress || undefined,
      });
      setAlerts(data);
    } catch (err) {
      console.error("Error fetching maintenance alerts:", err);
      setError(err instanceof Error ? err.message : "Failed to load maintenance alerts");
    } finally {
      setLoading(false);
    }
  }, [selectedPress]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // Categorize alerts by severity
  const urgentAlerts = alerts.filter((alert) => alert.severity === "urgent");
  const warnings = alerts.filter((alert) => alert.severity === "warning");
  const monitor = alerts.filter((alert) => alert.severity === "monitor");

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "urgent":
        return "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800";
      case "warning":
        return "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800";
      case "monitor":
        return "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800";
      default:
        return "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700";
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case "urgent":
        return <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />;
      case "warning":
        return <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />;
      case "monitor":
        return <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />;
      default:
        return null;
    }
  };

  const getTrendColor = (trend: number) => {
    if (trend > 0) {
      return "text-red-600 dark:text-red-400";
    } else if (trend < 0) {
      return "text-green-600 dark:text-green-400";
    }
    return "text-gray-600 dark:text-gray-400";
  };

  const formatTrend = (trend: number) => {
    if (trend > 0) {
      return `+${trend.toFixed(1)}%`;
    } else if (trend < 0) {
      return `${trend.toFixed(1)}%`;
    }
    return "0%";
  };

  const handleCategoryClick = async (press: string, category: string) => {
    setSelectedCategory({ press, category });
    setChartLoading(true);
    
    try {
      const data = await getWeeklyDowntimeData(press, category, 12);
      setWeeklyData(data);
    } catch (err) {
      console.error("Error fetching weekly downtime data:", err);
      setWeeklyData([]);
    } finally {
      setChartLoading(false);
    }
  };

  const formatWeekLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    const month = date.toLocaleDateString("en-US", { month: "short" });
    const day = date.getDate();
    return `${month} ${day}`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Maintenance Alerts</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Monitor equipment issues and maintenance needs across production lines
        </p>
      </div>

      {/* Filter */}
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
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Alerts Sections */}
      {!loading && !error && (
        <div className="space-y-6">
          {/* Urgent Alerts */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-6 py-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  🚨 Urgent Alerts ({urgentAlerts.length})
                </h2>
              </div>
            </div>
            <div className="p-6">
              {urgentAlerts.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                  No urgent alerts at this time
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Press
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Issue Category
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Current Week Minutes
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Trend %
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Recommendation
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {urgentAlerts.map((alert, index) => (
                        <tr
                          key={`urgent-${alert.press}-${alert.category}-${index}`}
                          className="hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors cursor-pointer"
                          onClick={() => handleCategoryClick(alert.press, alert.category)}
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                            {alert.press}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-medium">
                            {alert.category}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {alert.current_week_minutes.toFixed(0)}
                          </td>
                          <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${getTrendColor(alert.trend_pct)}`}>
                            {formatTrend(alert.trend_pct)}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                            {alert.recommendation}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Warnings */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 px-6 py-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  ⚠️ Warnings ({warnings.length})
                </h2>
              </div>
            </div>
            <div className="p-6">
              {warnings.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                  No warnings at this time
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Press
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Issue Category
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Current Week Minutes
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Trend %
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Recommendation
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {warnings.map((alert, index) => (
                        <tr
                          key={`warning-${alert.press}-${alert.category}-${index}`}
                          className="hover:bg-yellow-50 dark:hover:bg-yellow-900/10 transition-colors cursor-pointer"
                          onClick={() => handleCategoryClick(alert.press, alert.category)}
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                            {alert.press}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-medium">
                            {alert.category}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {alert.current_week_minutes.toFixed(0)}
                          </td>
                          <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${getTrendColor(alert.trend_pct)}`}>
                            {formatTrend(alert.trend_pct)}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                            {alert.recommendation}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Monitor */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-6 py-4">
              <div className="flex items-center gap-2">
                <Info className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  ℹ️ Monitor ({monitor.length})
                </h2>
              </div>
            </div>
            <div className="p-6">
              {monitor.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-4">
                  No items to monitor at this time
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Press
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Issue Category
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Current Week Minutes
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Trend %
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Recommendation
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {monitor.map((alert, index) => (
                        <tr
                          key={`monitor-${alert.press}-${alert.category}-${index}`}
                          className="hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors cursor-pointer"
                          onClick={() => handleCategoryClick(alert.press, alert.category)}
                        >
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                            {alert.press}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white font-medium">
                            {alert.category}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {alert.current_week_minutes.toFixed(0)}
                          </td>
                          <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${getTrendColor(alert.trend_pct)}`}>
                            {formatTrend(alert.trend_pct)}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                            {alert.recommendation}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Trend Chart Section */}
          {selectedCategory && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                    Weekly Trend: {selectedCategory.category}
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Press: {selectedCategory.press} • Last 12 weeks
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedCategory(null);
                    setWeeklyData([]);
                  }}
                  className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label="Close chart"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {chartLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
              ) : weeklyData.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400 text-center py-12">
                  No data available for this category
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={400}>
                  <LineChart
                    data={weeklyData.map((week) => ({
                      ...week,
                      week_label: formatWeekLabel(week.week_start_date),
                    }))}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                    <XAxis
                      dataKey="week_label"
                      stroke="#6b7280"
                      className="dark:stroke-gray-400"
                      tick={{ fill: "#6b7280", fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis
                      stroke="#6b7280"
                      className="dark:stroke-gray-400"
                      tick={{ fill: "#6b7280" }}
                      label={{
                        value: "Minutes",
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
                      formatter={(value: number) => [`${value.toFixed(0)} min`, "Downtime"]}
                      labelFormatter={(label) => `Week: ${label}`}
                    />
                    <ReferenceLine
                      y={240}
                      stroke="#ef4444"
                      strokeDasharray="5 5"
                      label={{ value: "Urgent (240 min)", position: "right", fill: "#ef4444" }}
                    />
                    <ReferenceLine
                      y={60}
                      stroke="#f59e0b"
                      strokeDasharray="5 5"
                      label={{ value: "Warning (60 min)", position: "right", fill: "#f59e0b" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="total_minutes"
                      stroke="#3b82f6"
                      fill="#3b82f6"
                      fillOpacity={0.3}
                      name="Downtime"
                    />
                    <Line
                      type="monotone"
                      dataKey="total_minutes"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ fill: "#3b82f6", r: 4 }}
                      activeDot={{ r: 6 }}
                      name="Downtime"
                    />
                    <Legend
                      wrapperStyle={{ paddingTop: "20px" }}
                      formatter={(value) => <span style={{ color: "#6b7280" }}>{value}</span>}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
