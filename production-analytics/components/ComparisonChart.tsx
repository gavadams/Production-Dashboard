"use client";

import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { getTeamTrainingNeeds } from "@/lib/database";

interface ComparisonChartProps {
  team_identifier: string;
  issue_category: string;
  time_period: number; // days
  press?: string; // Optional press filter
  issue_type: "Spoilage" | "Downtime";
}

interface ChartDataPoint {
  team_identifier: string;
  occurrences: number;
  impact: number;
  variance_from_avg: number;
  isSelected: boolean;
}

export default function ComparisonChart({
  team_identifier,
  issue_category,
  time_period,
  press,
  issue_type,
}: ComparisonChartProps) {
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [teamAverage, setTeamAverage] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchComparisonData = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch all team training needs for this issue category
        const allTeamNeeds = await getTeamTrainingNeeds(time_period, 0);
        
        // Filter by issue category and optionally by press
        const filteredNeeds = allTeamNeeds.filter(
          (need) =>
            need.issue_category === issue_category &&
            need.issue_type === issue_type &&
            (!press || need.press === press)
        );

        if (filteredNeeds.length === 0) {
          setChartData([]);
          setTeamAverage(0);
          setLoading(false);
          return;
        }

        // Calculate team average
        const avgOccurrences =
          filteredNeeds.reduce((sum, need) => sum + need.occurrence_count, 0) /
          filteredNeeds.length;

        setTeamAverage(avgOccurrences);

        // Prepare chart data
        const data: ChartDataPoint[] = filteredNeeds
          .map((need) => {
            const variance =
              avgOccurrences > 0
                ? ((need.occurrence_count - avgOccurrences) / avgOccurrences) * 100
                : 0;

            return {
              team_identifier: need.team_identifier,
              occurrences: need.occurrence_count,
              impact: need.total_impact,
              variance_from_avg: variance,
              isSelected: need.team_identifier === team_identifier,
            };
          })
          .sort((a, b) => a.occurrences - b.occurrences); // Sort by occurrences ascending

        setChartData(data);
      } catch (err) {
        console.error("Error fetching comparison data:", err);
        setError("Failed to load comparison data");
      } finally {
        setLoading(false);
      }
    };

    fetchComparisonData();
  }, [team_identifier, issue_category, time_period, press, issue_type]);

  // Determine bar color based on variance from average
  const getBarColor = (dataPoint: ChartDataPoint) => {
    if (dataPoint.isSelected) {
      return "#8b5cf6"; // Purple for selected team
    }

    const variance = Math.abs(dataPoint.variance_from_avg);
    
    if (variance < 10) {
      // Near average (within 10%)
      return "#eab308"; // Yellow
    } else if (dataPoint.variance_from_avg > 0) {
      // Above average
      return "#ef4444"; // Red
    } else {
      // Below average
      return "#10b981"; // Green
    }
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartDataPoint }> }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as ChartDataPoint;
      return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
          <div className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
            {data.team_identifier}
            {data.isSelected && (
              <span className="ml-2 text-xs text-purple-600 dark:text-purple-400">
                (Selected)
              </span>
            )}
          </div>
          <div className="space-y-1 text-xs">
            <div className="text-gray-600 dark:text-gray-400">
              Occurrences: <span className="font-medium text-gray-900 dark:text-white">{data.occurrences}</span>
            </div>
            <div className="text-gray-600 dark:text-gray-400">
              Impact:{" "}
              <span className="font-medium text-gray-900 dark:text-white">
                {issue_type === "Spoilage"
                  ? `${data.impact.toFixed(0)} units`
                  : `${Math.round(data.impact)} min`}
              </span>
            </div>
            <div className="text-gray-600 dark:text-gray-400">
              Variance:{" "}
              <span
                className={`font-medium ${
                  data.variance_from_avg > 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-green-600 dark:text-green-400"
                }`}
              >
                {data.variance_from_avg >= 0 ? "+" : ""}
                {data.variance_from_avg.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading comparison data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          No comparison data available for this issue category
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-3">
        <h5 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
          Team Comparison
        </h5>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          All teams sorted by occurrence count (lowest to highest)
        </p>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 40)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
          <XAxis
            type="number"
            stroke="#6b7280"
            className="dark:stroke-gray-400"
            tick={{ fill: "#6b7280", fontSize: 12 }}
            label={{
              value: "Occurrences",
              position: "insideBottom",
              offset: -5,
              style: { textAnchor: "middle", fill: "#6b7280" },
            }}
          />
          <YAxis
            type="category"
            dataKey="team_identifier"
            stroke="#6b7280"
            className="dark:stroke-gray-400"
            tick={{ fill: "#6b7280", fontSize: 11 }}
            width={90}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            x={teamAverage}
            stroke="#6366f1"
            strokeDasharray="5 5"
            strokeWidth={2}
            label={{
              value: `Avg: ${teamAverage.toFixed(1)}`,
              position: "top",
              fill: "#6366f1",
              fontSize: 11,
            }}
          />
          <Bar dataKey="occurrences" radius={[0, 4, 4, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getBarColor(entry)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-500 rounded"></div>
          <span>Below Average</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-yellow-500 rounded"></div>
          <span>Near Average (±10%)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-red-500 rounded"></div>
          <span>Above Average</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-purple-500 rounded"></div>
          <span>Selected Team</span>
        </div>
      </div>
    </div>
  );
}

