"use client";

import { useState, useEffect } from "react";
import { Save, Target, AlertCircle } from "lucide-react";
import toast from "react-hot-toast";
import { getPressTargets, savePressTargets } from "@/lib/database";
import { formatErrorMessage } from "@/lib/errorMessages";

const PRESS_CODES = ["LA01", "LA02", "LP03", "LP04", "LP05", "CL01"];

interface PressTarget {
  press: string;
  target_run_speed: number;
  target_efficiency_pct: number;
  target_spoilage_pct: number;
}

export default function SettingsPage() {
  const [targets, setTargets] = useState<PressTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchTargets();
  }, []);

  const fetchTargets = async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getPressTargets();
      
      // Initialize with defaults if no data exists
      const defaultTargets: PressTarget[] = PRESS_CODES.map((press) => {
        const existing = data.find((t) => t.press === press);
        return existing || {
          press,
          target_run_speed: 0,
          target_efficiency_pct: 0,
          target_spoilage_pct: 0,
        };
      });

      setTargets(defaultTargets);
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      setError(errorMsg);
      toast.error(errorMsg);
      console.error("Error fetching press targets:", err);
    } finally {
      setLoading(false);
    }
  };

  const validateTarget = (press: string, field: keyof PressTarget, value: number): string | null => {
    switch (field) {
      case "target_run_speed":
        if (isNaN(value) || value < 0) {
          return "Run speed must be a positive number";
        }
        if (value > 10000) {
          return "Run speed seems too high (max 10,000 sheets/hr)";
        }
        break;
      case "target_efficiency_pct":
        if (isNaN(value) || value < 0) {
          return "Efficiency must be a positive number";
        }
        if (value > 100) {
          return "Efficiency cannot exceed 100%";
        }
        break;
      case "target_spoilage_pct":
        if (isNaN(value) || value < 0) {
          return "Spoilage must be a positive number";
        }
        if (value > 50) {
          return "Spoilage seems too high (max 50%)";
        }
        break;
    }
    return null;
  };

  const handleTargetChange = (press: string, field: keyof PressTarget, value: string) => {
    const numValue = parseFloat(value) || 0;
    
    // Validate the input
    const validationError = validateTarget(press, field, numValue);
    const errorKey = `${press}_${field}`;
    
    if (validationError) {
      setValidationErrors((prev) => ({
        ...prev,
        [errorKey]: validationError,
      }));
    } else {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[errorKey];
        return newErrors;
      });
    }

    // Update the target
    setTargets((prev) =>
      prev.map((target) =>
        target.press === press
          ? { ...target, [field]: numValue }
          : target
      )
    );
  };

  const handleSave = async () => {
    // Check for validation errors
    const hasErrors = Object.keys(validationErrors).length > 0;
    if (hasErrors) {
      toast.error("Please fix validation errors before saving");
      return;
    }

    // Validate all targets before saving
    let hasValidationError = false;
    const newValidationErrors: Record<string, string> = {};

    targets.forEach((target) => {
      const speedError = validateTarget(target.press, "target_run_speed", target.target_run_speed);
      const efficiencyError = validateTarget(target.press, "target_efficiency_pct", target.target_efficiency_pct);
      const spoilageError = validateTarget(target.press, "target_spoilage_pct", target.target_spoilage_pct);

      if (speedError) {
        newValidationErrors[`${target.press}_target_run_speed`] = speedError;
        hasValidationError = true;
      }
      if (efficiencyError) {
        newValidationErrors[`${target.press}_target_efficiency_pct`] = efficiencyError;
        hasValidationError = true;
      }
      if (spoilageError) {
        newValidationErrors[`${target.press}_target_spoilage_pct`] = spoilageError;
        hasValidationError = true;
      }
    });

    if (hasValidationError) {
      setValidationErrors(newValidationErrors);
      toast.error("Please fix validation errors before saving");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await savePressTargets(targets);
      toast.success("Press targets saved successfully!");
    } catch (err) {
      const errorMsg = formatErrorMessage(err);
      setError(errorMsg);
      toast.error(errorMsg);
      console.error("Error saving press targets:", err);
    } finally {
      setSaving(false);
    }
  };

  const getValidationError = (press: string, field: keyof PressTarget): string | undefined => {
    return validationErrors[`${press}_${field}`];
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Target className="h-8 w-8 text-blue-600 dark:text-blue-400" />
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">
            Press Targets Configuration
          </h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Set target performance metrics for each press. These targets are used for performance comparisons and alerts.
        </p>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
          <div className="space-y-4 animate-pulse">
            {PRESS_CODES.map((press) => (
              <div key={press} className="flex items-center gap-4">
                <div className="h-10 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="h-10 flex-1 bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="h-10 flex-1 bg-gray-200 dark:bg-gray-700 rounded"></div>
                <div className="h-10 flex-1 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Press
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Target Run Speed (sheets/hr)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Target Efficiency (%)
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Target Spoilage (%)
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {targets.map((target) => (
                  <tr
                    key={target.press}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {target.press}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <input
                          type="number"
                          min="0"
                          max="10000"
                          step="0.1"
                          value={target.target_run_speed || ""}
                          onChange={(e) =>
                            handleTargetChange(target.press, "target_run_speed", e.target.value)
                          }
                          className={`
                            w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                            focus:outline-none focus:ring-2 focus:ring-blue-500
                            ${
                              getValidationError(target.press, "target_run_speed")
                                ? "border-red-500 dark:border-red-500"
                                : "border-gray-300 dark:border-gray-600"
                            }
                          `}
                          placeholder="0"
                        />
                        {getValidationError(target.press, "target_run_speed") && (
                          <span className="text-xs text-red-600 dark:text-red-400 mt-1">
                            {getValidationError(target.press, "target_run_speed")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          value={target.target_efficiency_pct || ""}
                          onChange={(e) =>
                            handleTargetChange(target.press, "target_efficiency_pct", e.target.value)
                          }
                          className={`
                            w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                            focus:outline-none focus:ring-2 focus:ring-blue-500
                            ${
                              getValidationError(target.press, "target_efficiency_pct")
                                ? "border-red-500 dark:border-red-500"
                                : "border-gray-300 dark:border-gray-600"
                            }
                          `}
                          placeholder="0"
                        />
                        {getValidationError(target.press, "target_efficiency_pct") && (
                          <span className="text-xs text-red-600 dark:text-red-400 mt-1">
                            {getValidationError(target.press, "target_efficiency_pct")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <input
                          type="number"
                          min="0"
                          max="50"
                          step="0.01"
                          value={target.target_spoilage_pct || ""}
                          onChange={(e) =>
                            handleTargetChange(target.press, "target_spoilage_pct", e.target.value)
                          }
                          className={`
                            w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                            focus:outline-none focus:ring-2 focus:ring-blue-500
                            ${
                              getValidationError(target.press, "target_spoilage_pct")
                                ? "border-red-500 dark:border-red-500"
                                : "border-gray-300 dark:border-gray-600"
                            }
                          `}
                          placeholder="0"
                        />
                        {getValidationError(target.press, "target_spoilage_pct") && (
                          <span className="text-xs text-red-600 dark:text-red-400 mt-1">
                            {getValidationError(target.press, "target_spoilage_pct")}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden divide-y divide-gray-200 dark:divide-gray-700">
            {targets.map((target) => (
              <div key={target.press} className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {target.press}
                  </h3>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Target Run Speed (sheets/hr)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="10000"
                      step="0.1"
                      value={target.target_run_speed || ""}
                      onChange={(e) =>
                        handleTargetChange(target.press, "target_run_speed", e.target.value)
                      }
                      className={`
                        w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                        focus:outline-none focus:ring-2 focus:ring-blue-500
                        ${
                          getValidationError(target.press, "target_run_speed")
                            ? "border-red-500 dark:border-red-500"
                            : "border-gray-300 dark:border-gray-600"
                        }
                      `}
                      placeholder="0"
                    />
                    {getValidationError(target.press, "target_run_speed") && (
                      <span className="text-xs text-red-600 dark:text-red-400 mt-1 block">
                        {getValidationError(target.press, "target_run_speed")}
                      </span>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Target Efficiency (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={target.target_efficiency_pct || ""}
                      onChange={(e) =>
                        handleTargetChange(target.press, "target_efficiency_pct", e.target.value)
                      }
                      className={`
                        w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                        focus:outline-none focus:ring-2 focus:ring-blue-500
                        ${
                          getValidationError(target.press, "target_efficiency_pct")
                            ? "border-red-500 dark:border-red-500"
                            : "border-gray-300 dark:border-gray-600"
                        }
                      `}
                      placeholder="0"
                    />
                    {getValidationError(target.press, "target_efficiency_pct") && (
                      <span className="text-xs text-red-600 dark:text-red-400 mt-1 block">
                        {getValidationError(target.press, "target_efficiency_pct")}
                      </span>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Target Spoilage (%)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="50"
                      step="0.01"
                      value={target.target_spoilage_pct || ""}
                      onChange={(e) =>
                        handleTargetChange(target.press, "target_spoilage_pct", e.target.value)
                      }
                      className={`
                        w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                        focus:outline-none focus:ring-2 focus:ring-blue-500
                        ${
                          getValidationError(target.press, "target_spoilage_pct")
                            ? "border-red-500 dark:border-red-500"
                            : "border-gray-300 dark:border-gray-600"
                        }
                      `}
                      placeholder="0"
                    />
                    {getValidationError(target.press, "target_spoilage_pct") && (
                      <span className="text-xs text-red-600 dark:text-red-400 mt-1 block">
                        {getValidationError(target.press, "target_spoilage_pct")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Save Button */}
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {Object.keys(validationErrors).length > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  Please fix {Object.keys(validationErrors).length} error(s) before saving
                </span>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={saving || Object.keys(validationErrors).length > 0}
              className={`
                flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-colors
                ${
                  saving || Object.keys(validationErrors).length > 0
                    ? "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }
              `}
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save Targets"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

