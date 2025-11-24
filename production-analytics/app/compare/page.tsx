"use client";

import { useState, useCallback, useEffect } from "react";
import { Calendar, GitCompare, Download } from "lucide-react";
import toast from "react-hot-toast";
import { getProductionComparison, getDailyProduction } from "@/lib/database";
import type { ProductionComparison } from "@/lib/database";
import { formatErrorMessage } from "@/lib/errorMessages";
import { supabase } from "@/lib/supabase";
import * as XLSX from "xlsx";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";


export default function ComparePage() {
  const [periodAStart, setPeriodAStart] = useState<string>("");
  const [periodAEnd, setPeriodAEnd] = useState<string>("");
  const [periodBStart, setPeriodBStart] = useState<string>("");
  const [periodBEnd, setPeriodBEnd] = useState<string>("");
  const [comparisonData, setComparisonData] = useState<ProductionComparison[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dailyTrendData, setDailyTrendData] = useState<Array<{ date: string; periodA: number; periodB: number }>>([]);
  const [downtimeCategoryData, setDowntimeCategoryData] = useState<Array<{ category: string; periodA: number; periodB: number }>>([]);

  // Set default dates (this week vs last week)
  useEffect(() => {
    const today = new Date();
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - today.getDay()); // Start of this week (Sunday)
    const thisWeekEnd = new Date(thisWeekStart);
    thisWeekEnd.setDate(thisWeekStart.getDate() + 6); // End of this week (Saturday)

    const lastWeekStart = new Date(thisWeekStart);
    lastWeekStart.setDate(thisWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(thisWeekStart);
    lastWeekEnd.setDate(thisWeekStart.getDate() - 1);

    setPeriodAStart(thisWeekStart.toISOString().split("T")[0]);
    setPeriodAEnd(thisWeekEnd.toISOString().split("T")[0]);
    setPeriodBStart(lastWeekStart.toISOString().split("T")[0]);
    setPeriodBEnd(lastWeekEnd.toISOString().split("T")[0]);
  }, []);


  const handleQuickSelect = (option: string) => {
    const today = new Date();
    let periodAStart: Date, periodAEnd: Date, periodBStart: Date, periodBEnd: Date;

    switch (option) {
      case "this_week_vs_last_week":
        // This week (Sunday to Saturday)
        periodAStart = new Date(today);
        periodAStart.setDate(today.getDate() - today.getDay());
        periodAEnd = new Date(periodAStart);
        periodAEnd.setDate(periodAStart.getDate() + 6);

        // Last week
        periodBStart = new Date(periodAStart);
        periodBStart.setDate(periodAStart.getDate() - 7);
        periodBEnd = new Date(periodAStart);
        periodBEnd.setDate(periodAStart.getDate() - 1);
        break;

      case "this_month_vs_last_month":
        // This month
        periodAStart = new Date(today.getFullYear(), today.getMonth(), 1);
        periodAEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        // Last month
        periodBStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        periodBEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        break;

      case "last_7_vs_previous_7":
        // Last 7 days
        periodAEnd = new Date(today);
        periodAStart = new Date(today);
        periodAStart.setDate(today.getDate() - 6);

        // Previous 7 days
        periodBEnd = new Date(periodAStart);
        periodBEnd.setDate(periodAStart.getDate() - 1);
        periodBStart = new Date(periodBEnd);
        periodBStart.setDate(periodBEnd.getDate() - 6);
        break;

      default:
        return;
    }

    setPeriodAStart(periodAStart.toISOString().split("T")[0]);
    setPeriodAEnd(periodAEnd.toISOString().split("T")[0]);
    setPeriodBStart(periodBStart.toISOString().split("T")[0]);
    setPeriodBEnd(periodBEnd.toISOString().split("T")[0]);
  };

  const handleCompare = useCallback(async () => {
    if (!periodAStart || !periodAEnd || !periodBStart || !periodBEnd) {
      toast.error("Please select date ranges for both periods");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use the new getProductionComparison function
      const comparisons = await getProductionComparison(
        periodAStart,
        periodAEnd,
        periodBStart,
        periodBEnd
      );

      setComparisonData(comparisons);

      // Fetch daily production trend data
      const trendData = await fetchDailyTrendData(periodAStart, periodAEnd, periodBStart, periodBEnd);
      setDailyTrendData(trendData);

      // Fetch downtime category data
      const downtimeData = await fetchDowntimeCategoryData(periodAStart, periodAEnd, periodBStart, periodBEnd);
      setDowntimeCategoryData(downtimeData);

      toast.success("Comparison completed successfully!");
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      setError(errorMsg);
      toast.error(errorMsg);
      console.error("Error comparing periods:", err);
    } finally {
      setLoading(false);
    }
  }, [periodAStart, periodAEnd, periodBStart, periodBEnd]);

  const fetchDailyTrendData = async (
    startA: string,
    endA: string,
    startB: string,
    endB: string
  ): Promise<Array<{ date: string; periodA: number; periodB: number }>> => {
    const trendMap = new Map<string, { periodA: number; periodB: number }>();

    // Fetch Period A daily data
    const startDateA = new Date(startA);
    const endDateA = new Date(endA);
    for (let d = new Date(startDateA); d <= endDateA; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      const dateParts = dateStr.split("-");
      const formattedDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
      
      try {
        const dailyData = await getDailyProduction(formattedDate);
        const totalProduction = dailyData.reduce((sum, row) => sum + (row.total_production || 0), 0);
        trendMap.set(dateStr, { periodA: totalProduction, periodB: 0 });
      } catch (err) {
        console.warn(`Error fetching daily data for ${formattedDate}:`, err);
      }
    }

    // Fetch Period B daily data
    const startDateB = new Date(startB);
    const endDateB = new Date(endB);
    for (let d = new Date(startDateB); d <= endDateB; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      const dateParts = dateStr.split("-");
      const formattedDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
      
      try {
        const dailyData = await getDailyProduction(formattedDate);
        const totalProduction = dailyData.reduce((sum, row) => sum + (row.total_production || 0), 0);
        const existing = trendMap.get(dateStr) || { periodA: 0, periodB: 0 };
        trendMap.set(dateStr, { ...existing, periodB: totalProduction });
      } catch (err) {
        console.warn(`Error fetching daily data for ${formattedDate}:`, err);
      }
    }

    // Convert to array and sort by date
    return Array.from(trendMap.entries())
      .map(([date, data]) => ({
        date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        dateSort: date, // Keep original date for sorting
        periodA: data.periodA,
        periodB: data.periodB,
      }))
      .sort((a, b) => a.dateSort.localeCompare(b.dateSort))
      .map(({ dateSort, ...rest }) => rest); // Remove dateSort from final output
  };

  const fetchDowntimeCategoryData = async (
    startA: string,
    endA: string,
    startB: string,
    endB: string
  ): Promise<Array<{ category: string; periodA: number; periodB: number }>> => {
    // Fetch Period A downtime categories
    const { data: dataA } = await supabase
      .from("downtime_events")
      .select("category, minutes")
      .gte("date", startA)
      .lte("date", endA);

    // Fetch Period B downtime categories
    const { data: dataB } = await supabase
      .from("downtime_events")
      .select("category, minutes")
      .gte("date", startB)
      .lte("date", endB);

    // Aggregate by category
    const categoryMap = new Map<string, { periodA: number; periodB: number }>();

    if (dataA) {
      dataA.forEach((event) => {
        const category = event.category || "Unknown";
        const existing = categoryMap.get(category) || { periodA: 0, periodB: 0 };
        categoryMap.set(category, {
          ...existing,
          periodA: existing.periodA + (event.minutes || 0),
        });
      });
    }

    if (dataB) {
      dataB.forEach((event) => {
        const category = event.category || "Unknown";
        const existing = categoryMap.get(category) || { periodA: 0, periodB: 0 };
        categoryMap.set(category, {
          ...existing,
          periodB: existing.periodB + (event.minutes || 0),
        });
      });
    }

    // Convert to array, sort by total minutes (descending), and take top 10
    return Array.from(categoryMap.entries())
      .map(([category, data]) => ({
        category,
        periodA: data.periodA,
        periodB: data.periodB,
      }))
      .sort((a, b) => (b.periodA + b.periodB) - (a.periodA + a.periodB))
      .slice(0, 10);
  };

  const formatChange = (change: number, changePct: number, isDowntime: boolean = false): string => {
    const sign = change >= 0 ? "+" : "";
    const arrow = isDowntime ? (change <= 0 ? "↓" : "↑") : change >= 0 ? "↑" : "↓";
    const changeValue = isDowntime ? Math.abs(change) : change;
    return `${sign}${changeValue.toLocaleString()} (${sign}${changePct.toFixed(1)}%) ${arrow}`;
  };

  const getChangeColor = (change: number, isDowntime: boolean = false): string => {
    if (isDowntime) {
      // For downtime, negative change (less downtime) is good
      return change <= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
    } else {
      // For production/speed, positive change is good
      return change >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
    }
  };

  const handleExportToExcel = async () => {
    if (comparisonData.length === 0) {
      toast.error("No comparison data to export");
      return;
    }

    try {
      // Create a new workbook
      const workbook = XLSX.utils.book_new();

      // Sheet 1: Summary Comparison Table
      const summaryData = comparisonData.map((row) => ({
        Press: row.press,
        "Period A Production": row.periodA_production,
        "Period B Production": row.periodB_production,
        "Production Change": row.production_change,
        "Production Change %": `${row.production_change_pct.toFixed(2)}%`,
        "Period A Avg Speed": row.periodA_avg_speed.toFixed(2),
        "Period B Avg Speed": row.periodB_avg_speed.toFixed(2),
        "Speed Change": row.speed_change.toFixed(2),
        "Speed Change %": `${row.speed_change_pct.toFixed(2)}%`,
        "Period A Avg Spoilage %": row.periodA_avg_spoilage.toFixed(2),
        "Period B Avg Spoilage %": row.periodB_avg_spoilage.toFixed(2),
        "Spoilage Change": row.spoilage_change.toFixed(2),
        "Spoilage Change %": `${row.spoilage_change_pct.toFixed(2)}%`,
        "Period A Downtime (min)": row.periodA_total_downtime,
        "Period B Downtime (min)": row.periodB_total_downtime,
        "Downtime Change (min)": row.downtime_change,
        "Downtime Change %": `${row.downtime_change_pct.toFixed(2)}%`,
        "Period A Run Count": row.periodA_run_count,
        "Period B Run Count": row.periodB_run_count,
      }));

      const summarySheet = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary Comparison");

      // Sheet 2: Detailed Daily Breakdown for Period A
      const dailyDataA: Array<{ Date: string; Press: string; Production: number; "Avg Speed": number; "Spoilage %": number; "Efficiency %": number }> = [];
      const startDateA = new Date(periodAStart);
      const endDateA = new Date(periodAEnd);
      for (let d = new Date(startDateA); d <= endDateA; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        const dateParts = dateStr.split("-");
        const formattedDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
        
        try {
          const dayData = await getDailyProduction(formattedDate);
          dayData.forEach((row) => {
            dailyDataA.push({
              Date: formattedDate,
              Press: row.press,
              Production: row.total_production,
              "Avg Speed": row.avg_run_speed,
              "Spoilage %": row.avg_spoilage_pct,
              "Efficiency %": row.efficiency_pct,
            });
          });
        } catch (err) {
          console.warn(`Error fetching daily data for ${formattedDate}:`, err);
        }
      }

      if (dailyDataA.length > 0) {
        const dailySheetA = XLSX.utils.json_to_sheet(dailyDataA);
        XLSX.utils.book_append_sheet(workbook, dailySheetA, "Period A Daily");
      }

      // Sheet 3: Detailed Daily Breakdown for Period B
      const dailyDataB: Array<{ Date: string; Press: string; Production: number; "Avg Speed": number; "Spoilage %": number; "Efficiency %": number }> = [];
      const startDateB = new Date(periodBStart);
      const endDateB = new Date(periodBEnd);
      for (let d = new Date(startDateB); d <= endDateB; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        const dateParts = dateStr.split("-");
        const formattedDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
        
        try {
          const dayData = await getDailyProduction(formattedDate);
          dayData.forEach((row) => {
            dailyDataB.push({
              Date: formattedDate,
              Press: row.press,
              Production: row.total_production,
              "Avg Speed": row.avg_run_speed,
              "Spoilage %": row.avg_spoilage_pct,
              "Efficiency %": row.efficiency_pct,
            });
          });
        } catch (err) {
          console.warn(`Error fetching daily data for ${formattedDate}:`, err);
        }
      }

      if (dailyDataB.length > 0) {
        const dailySheetB = XLSX.utils.json_to_sheet(dailyDataB);
        XLSX.utils.book_append_sheet(workbook, dailySheetB, "Period B Daily");
      }

      // Sheet 4: Downtime Comparison by Category
      const downtimeData = downtimeCategoryData.map((row) => ({
        Category: row.category,
        "Period A (min)": row.periodA,
        "Period B (min)": row.periodB,
        "Change (min)": row.periodA - row.periodB,
        "Change %": row.periodB > 0 ? `${(((row.periodA - row.periodB) / row.periodB) * 100).toFixed(2)}%` : "N/A",
      }));

      if (downtimeData.length > 0) {
        const downtimeSheet = XLSX.utils.json_to_sheet(downtimeData);
        XLSX.utils.book_append_sheet(workbook, downtimeSheet, "Downtime Comparison");
      }

      // Sheet 5: Spoilage Comparison by Category
      const { data: spoilageDataA } = await supabase
        .from("spoilage_events")
        .select("category, units")
        .gte("date", periodAStart)
        .lte("date", periodAEnd);

      const { data: spoilageDataB } = await supabase
        .from("spoilage_events")
        .select("category, units")
        .gte("date", periodBStart)
        .lte("date", periodBEnd);

      // Aggregate spoilage by category
      const spoilageMap = new Map<string, { periodA: number; periodB: number }>();

      if (spoilageDataA) {
        spoilageDataA.forEach((event) => {
          const category = event.category || "Unknown";
          const existing = spoilageMap.get(category) || { periodA: 0, periodB: 0 };
          spoilageMap.set(category, {
            ...existing,
            periodA: existing.periodA + (event.units || 0),
          });
        });
      }

      if (spoilageDataB) {
        spoilageDataB.forEach((event) => {
          const category = event.category || "Unknown";
          const existing = spoilageMap.get(category) || { periodA: 0, periodB: 0 };
          spoilageMap.set(category, {
            ...existing,
            periodB: existing.periodB + (event.units || 0),
          });
        });
      }

      const spoilageComparison = Array.from(spoilageMap.entries())
        .map(([category, data]) => ({
          Category: category,
          "Period A (units)": data.periodA,
          "Period B (units)": data.periodB,
          "Change (units)": data.periodA - data.periodB,
          "Change %": data.periodB > 0 ? `${(((data.periodA - data.periodB) / data.periodB) * 100).toFixed(2)}%` : "N/A",
        }))
        .sort((a, b) => (b["Period A (units)"] + b["Period B (units)"]) - (a["Period A (units)"] + a["Period B (units)"]))
        .slice(0, 20); // Top 20 categories

      if (spoilageComparison.length > 0) {
        const spoilageSheet = XLSX.utils.json_to_sheet(spoilageComparison);
        XLSX.utils.book_append_sheet(workbook, spoilageSheet, "Spoilage Comparison");
      }

      // Generate filename
      const dateAStr = periodAStart.replace(/-/g, "");
      const dateBStr = periodBStart.replace(/-/g, "");
      const filename = `comparison_report_${dateAStr}_vs_${dateBStr}.xlsx`;

      // Write workbook and download
      XLSX.writeFile(workbook, filename);
      toast.success("Excel file exported successfully!");
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      toast.error(`Failed to export Excel: ${errorMsg}`);
      console.error("Error exporting to Excel:", err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <GitCompare className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Period Comparison</h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Compare production performance between two time periods to identify trends and improvements
        </p>
      </div>

      {/* Date Range Selectors */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Period A */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Period A
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="period-a-start" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Start Date
                </label>
                <input
                  id="period-a-start"
                  type="date"
                  value={periodAStart}
                  onChange={(e) => setPeriodAStart(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="period-a-end" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  End Date
                </label>
                <input
                  id="period-a-end"
                  type="date"
                  value={periodAEnd}
                  onChange={(e) => setPeriodAEnd(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Period B */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Period B
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="period-b-start" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Start Date
                </label>
                <input
                  id="period-b-start"
                  type="date"
                  value={periodBStart}
                  onChange={(e) => setPeriodBStart(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label htmlFor="period-b-end" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  End Date
                </label>
                <input
                  id="period-b-end"
                  type="date"
                  value={periodBEnd}
                  onChange={(e) => setPeriodBEnd(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Quick Select Buttons */}
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Quick Select:</h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleQuickSelect("this_week_vs_last_week")}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            >
              This Week vs Last Week
            </button>
            <button
              onClick={() => handleQuickSelect("this_month_vs_last_month")}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            >
              This Month vs Last Month
            </button>
            <button
              onClick={() => handleQuickSelect("last_7_vs_previous_7")}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            >
              Last 7 Days vs Previous 7 Days
            </button>
          </div>
        </div>

        {/* Compare Button */}
        <button
          onClick={handleCompare}
          disabled={loading || !periodAStart || !periodAEnd || !periodBStart || !periodBEnd}
          className={`
            w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-medium transition-colors
            ${
              loading || !periodAStart || !periodAEnd || !periodBStart || !periodBEnd
                ? "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }
          `}
        >
          {loading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              Comparing...
            </>
          ) : (
            <>
              <GitCompare className="h-5 w-5" />
              Compare
            </>
          )}
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Export Button */}
      {comparisonData.length > 0 && (
        <div className="mb-6 flex justify-end">
          <button
            onClick={handleExportToExcel}
            className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors shadow-md"
          >
            <Download className="h-5 w-5" />
            Export to Excel
          </button>
        </div>
      )}

      {/* Charts Section */}
      {comparisonData.length > 0 && (
        <div className="space-y-6 mb-6">
          {/* Side-by-side Production Bar Charts */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Production by Press</h2>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-300 dark:stroke-gray-700" />
                <XAxis
                  dataKey="press"
                  className="text-gray-600 dark:text-gray-400"
                  tick={{ fill: "currentColor" }}
                />
                <YAxis className="text-gray-600 dark:text-gray-400" tick={{ fill: "currentColor" }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "rgba(255, 255, 255, 0.95)",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                  }}
                  className="dark:bg-gray-800 dark:border-gray-700"
                />
                <Legend />
                <Bar dataKey="periodA_production" fill="#3b82f6" name="Period A" />
                <Bar dataKey="periodB_production" fill="#10b981" name="Period B" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Daily Production Trend Line Chart */}
          {dailyTrendData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Daily Production Trend</h2>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={dailyTrendData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-gray-300 dark:stroke-gray-700" />
                  <XAxis
                    dataKey="date"
                    className="text-gray-600 dark:text-gray-400"
                    tick={{ fill: "currentColor" }}
                  />
                  <YAxis className="text-gray-600 dark:text-gray-400" tick={{ fill: "currentColor" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(255, 255, 255, 0.95)",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                    }}
                    className="dark:bg-gray-800 dark:border-gray-700"
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="periodA"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    name="Period A"
                    dot={{ r: 4 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="periodB"
                    stroke="#10b981"
                    strokeWidth={2}
                    name="Period B"
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Downtime Category Comparison */}
          {downtimeCategoryData.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Top 10 Downtime Categories</h2>
              <ResponsiveContainer width="100%" height={500}>
                <BarChart
                  data={downtimeCategoryData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 100, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-gray-300 dark:stroke-gray-700" />
                  <XAxis type="number" className="text-gray-600 dark:text-gray-400" tick={{ fill: "currentColor" }} />
                  <YAxis
                    dataKey="category"
                    type="category"
                    width={90}
                    className="text-gray-600 dark:text-gray-400"
                    tick={{ fill: "currentColor" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(255, 255, 255, 0.95)",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                    }}
                    className="dark:bg-gray-800 dark:border-gray-700"
                    formatter={(value: number) => `${Math.floor(value / 60)}h ${value % 60}m`}
                  />
                  <Legend />
                  <Bar dataKey="periodA" fill="#3b82f6" name="Period A" />
                  <Bar dataKey="periodB" fill="#10b981" name="Period B" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Results Table */}
      {comparisonData.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Press
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Period A Production
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Period B Production
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Change
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Period A Avg Speed
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Period B Avg Speed
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Speed Change
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Period A Downtime
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Period B Downtime
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Downtime Change
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {comparisonData.map((row) => (
                  <tr key={row.press} className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                      {row.press}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {row.periodA_production.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {row.periodB_production.toLocaleString()}
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${getChangeColor(row.production_change)}`}>
                      {formatChange(row.production_change, row.production_change_pct)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {row.periodA_avg_speed.toFixed(1)} /hr
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {row.periodB_avg_speed.toFixed(1)} /hr
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${getChangeColor(row.speed_change)}`}>
                      {formatChange(row.speed_change, row.speed_change_pct)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {Math.floor(row.periodA_total_downtime / 60)}h {row.periodA_total_downtime % 60}m
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {Math.floor(row.periodB_total_downtime / 60)}h {row.periodB_total_downtime % 60}m
                    </td>
                    <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${getChangeColor(row.downtime_change, true)}`}>
                      {formatChange(row.downtime_change, row.downtime_change_pct, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && comparisonData.length === 0 && !error && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-12 text-center">
          <GitCompare className="h-12 w-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No Comparison Data</h3>
          <p className="text-gray-600 dark:text-gray-400">
            Select date ranges for Period A and Period B, then click &quot;Compare&quot; to see the results.
          </p>
        </div>
      )}
    </div>
  );
}

