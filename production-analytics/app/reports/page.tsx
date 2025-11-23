"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Calendar, Download, Filter, X, Clock, TrendingUp, AlertTriangle, Package } from "lucide-react";
import { getProductionRunReports, searchWorkOrder } from "@/lib/database";
import type { ProductionRunReport, WorkOrderSearchResult } from "@/lib/database";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const PRESS_CODES = ["LA01", "LA02", "LP03", "LP04", "LP05", "CL01"];
const SHIFTS = ["Earlies", "Lates", "Nights"];
const TEAMS = ["A", "B", "C"];

export default function ReportsPage() {
  const [workOrderSearch, setWorkOrderSearch] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedPress, setSelectedPress] = useState<string>("");
  const [selectedShift, setSelectedShift] = useState<string>("");
  const [selectedTeam, setSelectedTeam] = useState<string>("");
  
  const [reports, setReports] = useState<ProductionRunReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Work order detail modal state
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<string | null>(null);
  const [workOrderDetails, setWorkOrderDetails] = useState<WorkOrderSearchResult[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // Set default date range to last 30 days
  useEffect(() => {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    setEndDate(today.toISOString().split("T")[0]);
    setStartDate(thirtyDaysAgo.toISOString().split("T")[0]);
  }, []);

  const fetchReports = useCallback(async () => {
    if (!startDate || !endDate) {
      return; // Don't fetch if dates aren't set
    }

    setLoading(true);
    setError(null);

    try {
      const data = await getProductionRunReports({
        workOrder: workOrderSearch.trim() || undefined,
        startDate,
        endDate,
        press: selectedPress || undefined,
        shift: selectedShift || undefined,
        team: selectedTeam || undefined,
      });
      setReports(data);
    } catch (err) {
      console.error("Error fetching reports:", err);
      setError(err instanceof Error ? err.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  }, [workOrderSearch, startDate, endDate, selectedPress, selectedShift, selectedTeam]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const handleWorkOrderClick = async (workOrder: string) => {
    if (!workOrder) return;
    
    setSelectedWorkOrder(workOrder);
    setDetailsLoading(true);
    setDetailsError(null);
    
    try {
      const details = await searchWorkOrder(workOrder, startDate, endDate);
      setWorkOrderDetails(details);
    } catch (err) {
      console.error("Error fetching work order details:", err);
      setDetailsError(err instanceof Error ? err.message : "Failed to load work order details");
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (reports.length === 0) {
      alert("No data to export");
      return;
    }

    // CSV headers
    const headers = [
      "Date",
      "Press",
      "Shift",
      "Team",
      "Work Order",
      "Production",
      "Speed (/hr)",
      "Spoilage %",
      "Make Ready Time (min)",
    ];

    // CSV rows
    const rows = reports.map((report) => [
      report.date,
      report.press,
      report.shift,
      report.team,
      report.work_order || "",
      report.good_production.toString(),
      report.calculated_run_speed.toFixed(2),
      report.spoilage_percentage.toFixed(2),
      report.make_ready_minutes.toString(),
    ]);

    // Combine headers and rows
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    // Create blob and download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `production_reports_${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Production Reports</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Search and filter production run data by work order, date range, press, shift, and team
        </p>
      </div>

      {/* Search and Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Search & Filters</h2>
        </div>

        <div className="space-y-4">
          {/* Work Order Search */}
          <div>
            <label htmlFor="work-order-search" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <Search className="h-4 w-4 inline mr-1" />
              Search by Work Order Number
            </label>
            <input
              id="work-order-search"
              type="text"
              value={workOrderSearch}
              onChange={(e) => setWorkOrderSearch(e.target.value)}
              placeholder="Enter work order number..."
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="start-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Calendar className="h-4 w-4 inline mr-1" />
                Start Date
              </label>
              <input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="end-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Calendar className="h-4 w-4 inline mr-1" />
                End Date
              </label>
              <input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Additional Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    {team}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Results Section */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Results ({reports.length})
          </h2>
          <button
            onClick={handleExportCSV}
            disabled={reports.length === 0}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors
              ${
                reports.length > 0
                  ? "bg-green-600 hover:bg-green-700 text-white"
                  : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
              }
            `}
          >
            <Download className="h-4 w-4" />
            Export to CSV
          </button>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-6">
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-red-800 dark:text-red-200">{error}</p>
            </div>
          </div>
        )}

        {/* Results Table */}
        {!loading && !error && (
          <div className="overflow-x-auto">
            {reports.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-gray-500 dark:text-gray-400">
                  No production runs found for the selected filters
                </p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Press
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Shift
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Team
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Work Order
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Production
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Speed (/hr)
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Spoilage %
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Make Ready Time (min)
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {reports.map((report) => (
                    <tr
                      key={report.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {report.date}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                        {report.press}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {report.shift}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {report.team}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        {report.work_order ? (
                          <button
                            onClick={() => handleWorkOrderClick(report.work_order!)}
                            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline font-medium"
                          >
                            {report.work_order}
                          </button>
                        ) : (
                          <span className="text-gray-900 dark:text-white">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {report.good_production.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {report.calculated_run_speed.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {report.spoilage_percentage.toFixed(2)}%
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {report.make_ready_minutes}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
