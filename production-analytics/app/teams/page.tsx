"use client";

import { useState, useEffect, useCallback } from "react";
import { Filter, ArrowUpDown, ArrowUp, ArrowDown, GraduationCap, Users } from "lucide-react";
import toast from "react-hot-toast";
import { getTeamPerformance, getTeamTrainingNeeds, getTrainingRecommendation } from "@/lib/database";
import type { TeamPerformanceData, TeamTrainingNeed } from "@/lib/database";
import { formatErrorMessage } from "@/lib/errorMessages";
import EmptyState from "@/components/EmptyState";
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
  const [trainingNeeds, setTrainingNeeds] = useState<TeamTrainingNeed[]>([]);
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
      setTrainingNeeds(trainingData);
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Team Performance</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Compare team performance metrics across presses and shifts
        </p>
      </div>

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
                    {(
                  sortedTeams.map((team) => (
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
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
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
      {!loading && !error && trainingNeeds.length > 0 && (
        <div className="mt-12">
          <div className="flex items-center gap-2 mb-6">
            <GraduationCap className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              Training Opportunities
            </h2>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Team
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Issue Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Category
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Occurrences
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Impact
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Recommended Training
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {trainingNeeds
                    .sort((a, b) => b.occurrence_count - a.occurrence_count)
                    .map((need, index) => (
                      <tr
                        key={`${need.team_identifier}-${need.issue_category}-${index}`}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {need.team_identifier}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {need.press} • {need.shift} • {need.team}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              need.issue_type === "Spoilage"
                                ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                            }`}
                          >
                            {need.issue_type}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {need.issue_category}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {need.occurrence_count}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {need.issue_type === "Spoilage"
                            ? `${need.total_impact.toFixed(0)} units`
                            : `${Math.round(need.total_impact)} min`}
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            Avg: {need.avg_impact.toFixed(1)}
                            {need.issue_type === "Spoilage" ? " units" : " min"}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                          <div className="flex items-center gap-2">
                            <GraduationCap className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                            <span>{getTrainingRecommendation(need.issue_category)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
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
    </div>
  );
}
