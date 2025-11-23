"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Calendar, Download, Filter, X, Clock, TrendingUp, AlertTriangle, Package, FileSearch } from "lucide-react";
import toast from "react-hot-toast";
import { getProductionRunReports, searchWorkOrder } from "@/lib/database";
import type { ProductionRunReport, WorkOrderSearchResult } from "@/lib/database";
import { formatErrorMessage, formatSuccessMessage } from "@/lib/errorMessages";
import EmptyState from "@/components/EmptyState";
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
      const errorMsg = formatErrorMessage(err);
      setError(errorMsg);
      toast.error(errorMsg);
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
      const errorMsg = formatErrorMessage(err);
      setDetailsError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (reports.length === 0) {
      toast.error("No data to export");
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
    // Clean up the URL object to prevent memory leaks
    URL.revokeObjectURL(url);
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

        {/* Loading State - Skeleton Loaders */}
        {loading && (
          <div className="p-6 space-y-4 animate-pulse">
            <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 rounded mb-4"></div>
            <div className="space-y-3">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div key={i} className="flex items-center gap-4 py-3 border-b border-gray-200 dark:border-gray-700">
                  <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
                  <div className="h-4 w-28 bg-gray-200 dark:bg-gray-700 rounded"></div>
                </div>
              ))}
            </div>
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
                  <div className="p-12">
                    <EmptyState
                      icon={FileSearch}
                      title="No Reports Found"
                      description={`No production runs match your search criteria. Try adjusting the work order number, date range, press, shift, or team filters.`}
                      action={{
                        label: "Clear Filters",
                        onClick: () => {
                          setWorkOrderSearch("");
                          setSelectedPress("");
                          setSelectedShift("");
                          setSelectedTeam("");
                          const today = new Date();
                          const thirtyDaysAgo = new Date();
                          thirtyDaysAgo.setDate(today.getDate() - 30);
                          setEndDate(today.toISOString().split("T")[0]);
                          setStartDate(thirtyDaysAgo.toISOString().split("T")[0]);
                        },
                      }}
                    />
                  </div>
                ) : (
                  <>
                    {/* Mobile Card View */}
                    <div className="md:hidden space-y-4 p-4">
                      {reports.map((report) => (
                        <div
                          key={report.id}
                          className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
                        >
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-sm font-medium text-gray-900 dark:text-white">
                                  {report.work_order || "No Work Order"}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                  {report.date} • {report.press}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm font-semibold text-gray-900 dark:text-white">
                                  {report.good_production.toLocaleString()}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                  {report.calculated_run_speed.toFixed(1)} /hr
                                </div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <span className="text-gray-600 dark:text-gray-400">Shift:</span>
                                <span className="ml-1 text-gray-900 dark:text-white">{report.shift}</span>
                              </div>
                              <div>
                                <span className="text-gray-600 dark:text-gray-400">Team:</span>
                                <span className="ml-1 text-gray-900 dark:text-white">{report.team}</span>
                              </div>
                              <div>
                                <span className="text-gray-600 dark:text-gray-400">Spoilage:</span>
                                <span className="ml-1 text-gray-900 dark:text-white">{report.spoilage_percentage.toFixed(2)}%</span>
                              </div>
                              <div>
                                <span className="text-gray-600 dark:text-gray-400">Make Ready:</span>
                                <span className="ml-1 text-gray-900 dark:text-white">{report.make_ready_minutes} min</span>
                              </div>
                            </div>
                            {report.work_order && (
                              <button
                                onClick={() => handleWorkOrderClick(report.work_order!)}
                                className="w-full mt-2 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors"
                              >
                                View Details
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    {/* Desktop Table View */}
                    <div className="hidden md:block overflow-x-auto">
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
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

      {/* Work Order Detail Modal */}
      {selectedWorkOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Work Order: {selectedWorkOrder}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {workOrderDetails.length} run{workOrderDetails.length !== 1 ? "s" : ""} found
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedWorkOrder(null);
                  setWorkOrderDetails([]);
                  setDetailsError(null);
                }}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                aria-label="Close modal"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6">
              {detailsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
              ) : detailsError ? (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-red-800 dark:text-red-200">{detailsError}</p>
                </div>
              ) : workOrderDetails.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-gray-500 dark:text-gray-400">No details found for this work order</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Summary Section */}
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                      <Package className="h-5 w-5" />
                      Work Order Summary
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Total Production</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">
                          {workOrderDetails.reduce((sum, run) => sum + run.good_production, 0).toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Total Downtime</p>
                        <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                          {workOrderDetails.reduce((sum, run) => sum + run.total_downtime_minutes, 0)} min
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Total Spoilage</p>
                        <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                          {workOrderDetails.reduce((sum, run) => sum + run.total_spoilage_units, 0)} units
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600 dark:text-gray-400">Avg Speed</p>
                        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                          {workOrderDetails.length > 0
                            ? (
                                workOrderDetails.reduce((sum, run) => sum + run.calculated_run_speed, 0) /
                                workOrderDetails.length
                              ).toFixed(1)
                            : "0.0"}{" "}
                          /hr
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Timeline Section */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      Timeline
                    </h3>
                    <div className="space-y-3">
                      {workOrderDetails.map((run) => (
                        <div
                          key={run.id}
                          className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-4">
                              <div>
                                <p className="font-medium text-gray-900 dark:text-white">{run.date}</p>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                  {run.shift} • Team {run.team} • {run.press}
                                </p>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium text-gray-900 dark:text-white">
                              {run.good_production.toLocaleString()} units
                            </p>
                            <p className="text-xs text-gray-600 dark:text-gray-400">
                              {run.calculated_run_speed.toFixed(1)} /hr
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Breakdown Section */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Make Ready & Running Time */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <TrendingUp className="h-5 w-5" />
                        Time Breakdown
                      </h3>
                      <div className="space-y-4">
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Total Make Ready Time</p>
                          <p className="text-2xl font-bold text-gray-900 dark:text-white">
                            {workOrderDetails.reduce((sum, run) => sum + run.make_ready_minutes, 0)} min
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Total Production Time</p>
                          <p className="text-2xl font-bold text-gray-900 dark:text-white">
                            {workOrderDetails.reduce((sum, run) => sum + run.production_minutes, 0)} min
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Total Logged Downtime</p>
                          <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                            {workOrderDetails.reduce((sum, run) => sum + run.logged_downtime_minutes, 0)} min
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Downtime by Category */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5" />
                        Downtime by Category
                      </h3>
                      {(() => {
                        const downtimeByCategory = new Map<string, number>();
                        workOrderDetails.forEach((run) => {
                          run.downtime_events.forEach((event) => {
                            const current = downtimeByCategory.get(event.category) || 0;
                            downtimeByCategory.set(event.category, current + event.minutes);
                          });
                        });

                        if (downtimeByCategory.size === 0) {
                          return <p className="text-gray-500 dark:text-gray-400">No downtime events</p>;
                        }

                        const chartData = Array.from(downtimeByCategory.entries())
                          .map(([category, minutes]) => ({ category, minutes }))
                          .sort((a, b) => b.minutes - a.minutes);

                        return (
                          <ResponsiveContainer width="100%" height={250}>
                            <BarChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                              <XAxis
                                dataKey="category"
                                angle={-45}
                                textAnchor="end"
                                height={100}
                                stroke="#6b7280"
                                className="dark:stroke-gray-400"
                                tick={{ fill: "#6b7280", fontSize: 10 }}
                              />
                              <YAxis
                                stroke="#6b7280"
                                className="dark:stroke-gray-400"
                                tick={{ fill: "#6b7280" }}
                                label={{ value: "Minutes", angle: -90, position: "insideLeft", style: { textAnchor: "middle", fill: "#6b7280" } }}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "white",
                                  border: "1px solid #e5e7eb",
                                  borderRadius: "8px",
                                }}
                                formatter={(value: number) => [`${value.toFixed(0)} min`, "Downtime"]}
                              />
                              <Bar dataKey="minutes" fill="#ef4444" radius={[8, 8, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Spoilage Breakdown */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                      <Package className="h-5 w-5" />
                      Spoilage by Category
                    </h3>
                    {(() => {
                      const spoilageByCategory = new Map<string, number>();
                      workOrderDetails.forEach((run) => {
                        run.spoilage_events.forEach((event) => {
                          const current = spoilageByCategory.get(event.category) || 0;
                          spoilageByCategory.set(event.category, current + event.units);
                        });
                      });

                      if (spoilageByCategory.size === 0) {
                        return <p className="text-gray-500 dark:text-gray-400">No spoilage events</p>;
                      }

                      const chartData = Array.from(spoilageByCategory.entries())
                        .map(([category, units]) => ({ category, units }))
                        .sort((a, b) => b.units - a.units);

                      const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];

                      return (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
                              <XAxis
                                dataKey="category"
                                angle={-45}
                                textAnchor="end"
                                height={100}
                                stroke="#6b7280"
                                className="dark:stroke-gray-400"
                                tick={{ fill: "#6b7280", fontSize: 10 }}
                              />
                              <YAxis
                                stroke="#6b7280"
                                className="dark:stroke-gray-400"
                                tick={{ fill: "#6b7280" }}
                                label={{ value: "Units", angle: -90, position: "insideLeft", style: { textAnchor: "middle", fill: "#6b7280" } }}
                              />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "white",
                                  border: "1px solid #e5e7eb",
                                  borderRadius: "8px",
                                }}
                                formatter={(value: number) => [`${value.toFixed(0)} units`, "Spoilage"]}
                              />
                              <Bar dataKey="units" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                          <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                              <Pie
                                data={chartData}
                                cx="50%"
                                cy="50%"
                                labelLine={false}
                                label={(props: { percent?: number; name?: string }) => {
                                  const name = props.name || "";
                                  const percent = props.percent || 0;
                                  return `${name}: ${(percent * 100).toFixed(0)}%`;
                                }}
                                outerRadius={80}
                                fill="#8884d8"
                                dataKey="units"
                                nameKey="category"
                              >
                                {chartData.map((entry, index) => (
                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "white",
                                  border: "1px solid #e5e7eb",
                                  borderRadius: "8px",
                                }}
                                formatter={(value: number) => [`${value.toFixed(0)} units`, "Spoilage"]}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Performance Comparison */}
                  <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      Team Performance Comparison
                    </h3>
                    {(() => {
                      const teamStats = new Map<
                        string,
                        {
                          team: string;
                          shift: string;
                          press: string;
                          production: number;
                          speed: number;
                          spoilage: number;
                          makeReady: number;
                        }
                      >();

                      workOrderDetails.forEach((run) => {
                        const key = `${run.press}_${run.shift}_${run.team}`;
                        const existing = teamStats.get(key);
                        if (existing) {
                          existing.production += run.good_production;
                          existing.speed = (existing.speed + run.calculated_run_speed) / 2;
                          existing.spoilage += run.total_spoilage_units;
                          existing.makeReady += run.make_ready_minutes;
                        } else {
                          teamStats.set(key, {
                            team: run.team,
                            shift: run.shift,
                            press: run.press,
                            production: run.good_production,
                            speed: run.calculated_run_speed,
                            spoilage: run.total_spoilage_units,
                            makeReady: run.make_ready_minutes,
                          });
                        }
                      });

                      const teams = Array.from(teamStats.values());
                      if (teams.length === 0) {
                        return <p className="text-gray-500 dark:text-gray-400">No team data available</p>;
                      }

                      const fastestTeam = teams.reduce((prev, current) =>
                        current.speed > prev.speed ? current : prev
                      );
                      const leastSpoilageTeam = teams.reduce((prev, current) =>
                        current.spoilage < prev.spoilage ? current : prev
                      );

                      return (
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Fastest Team</p>
                              <p className="text-xl font-bold text-gray-900 dark:text-white">
                                Team {fastestTeam.team} ({fastestTeam.shift})
                              </p>
                              <p className="text-sm text-gray-600 dark:text-gray-400">
                                {fastestTeam.speed.toFixed(1)} /hr • {fastestTeam.press}
                              </p>
                            </div>
                            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                              <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Least Spoilage</p>
                              <p className="text-xl font-bold text-gray-900 dark:text-white">
                                Team {leastSpoilageTeam.team} ({leastSpoilageTeam.shift})
                              </p>
                              <p className="text-sm text-gray-600 dark:text-gray-400">
                                {leastSpoilageTeam.spoilage} units • {leastSpoilageTeam.press}
                              </p>
                            </div>
                          </div>

                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                              <thead className="bg-gray-50 dark:bg-gray-900">
                                <tr>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                                    Team
                                  </th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                                    Shift
                                  </th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                                    Production
                                  </th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                                    Speed (/hr)
                                  </th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                                    Spoilage
                                  </th>
                                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                                    Make Ready (min)
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                {teams.map((team, index) => (
                                  <tr
                                    key={index}
                                    className={`${
                                      team.team === fastestTeam.team && team.shift === fastestTeam.shift
                                        ? "bg-green-50 dark:bg-green-900/20"
                                        : team.team === leastSpoilageTeam.team && team.shift === leastSpoilageTeam.shift
                                        ? "bg-blue-50 dark:bg-blue-900/20"
                                        : ""
                                    }`}
                                  >
                                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                                      {team.team}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{team.shift}</td>
                                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                                      {team.production.toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                                      {team.speed.toFixed(1)}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                                      {team.spoilage}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                                      {team.makeReady}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
