"use client";

import { useState, useEffect } from "react";
import { X, Calendar, FileText } from "lucide-react";
import toast from "react-hot-toast";
import { supabase } from "@/lib/supabase";
import { getTeamTrainingNeeds } from "@/lib/database";
import type { TrainingRecommendation } from "@/lib/database";

interface MarkTrainingCompletedModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamIdentifier: string;
  issueCategory: string;
  trainingRecommendation: TrainingRecommendation | undefined;
  press: string;
  issueType: "Spoilage" | "Downtime";
  onSuccess: () => void;
}

export default function MarkTrainingCompletedModal({
  isOpen,
  onClose,
  teamIdentifier,
  issueCategory,
  trainingRecommendation,
  press,
  issueType,
  onSuccess,
}: MarkTrainingCompletedModalProps) {
  const [trainingDate, setTrainingDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Set default date to today
  useEffect(() => {
    if (isOpen) {
      const today = new Date();
      setTrainingDate(today.toISOString().split("T")[0]);
      setNotes("");
    }
  }, [isOpen]);

  const calculateBeforeMetrics = async (trainingDateStr: string) => {
    const trainingDate = new Date(trainingDateStr);
    const beforePeriodEnd = new Date(trainingDate);
    beforePeriodEnd.setDate(beforePeriodEnd.getDate() - 1); // Day before training
    const beforePeriodStart = new Date(beforePeriodEnd);
    beforePeriodStart.setDate(beforePeriodStart.getDate() - 30); // 30 days before

    // Fetch team training needs for this period
    const daysBack = Math.ceil((Date.now() - beforePeriodStart.getTime()) / (1000 * 60 * 60 * 24));
    const allTeamNeeds = await getTeamTrainingNeeds(daysBack, 0);

    // Filter for this team, category, and press
    const relevantNeeds = allTeamNeeds.filter(
      (need) =>
        need.team_identifier === teamIdentifier &&
        need.issue_category === issueCategory &&
        need.press === press &&
        need.issue_type === issueType
    );

    if (relevantNeeds.length === 0) {
      return {
        before_occurrence_count: 0,
        before_total_impact: 0,
        before_avg_per_week: 0,
      };
    }

    // Sum up occurrences and impact
    const totalOccurrences = relevantNeeds.reduce((sum, need) => sum + need.occurrence_count, 0);
    const totalImpact = relevantNeeds.reduce((sum, need) => sum + need.total_impact, 0);
    const avgPerWeek = (totalOccurrences / 30) * 7; // Average per week

    return {
      before_occurrence_count: totalOccurrences,
      before_total_impact: totalImpact,
      before_avg_per_week: avgPerWeek,
    };
  };

  const handleSave = async () => {
    if (!trainingDate) {
      toast.error("Please select a training completion date");
      return;
    }

    setSaving(true);

    try {
      // Calculate before metrics
      const beforeMetrics = await calculateBeforeMetrics(trainingDate);

      // Get training recommendation ID if available
      let trainingRecommendationId: string | null = null;
      if (trainingRecommendation) {
        trainingRecommendationId = trainingRecommendation.id;
      } else {
        // Try to find training recommendation by category
        const { data: trainingRec } = await supabase
          .from("training_recommendations")
          .select("id")
          .eq("issue_category", issueCategory)
          .single();

        if (trainingRec) {
          trainingRecommendationId = trainingRec.id;
        }
      }

      // Calculate period dates
      const trainingDateObj = new Date(trainingDate);
      const beforePeriodEnd = new Date(trainingDateObj);
      beforePeriodEnd.setDate(beforePeriodEnd.getDate() - 1);
      const beforePeriodStart = new Date(beforePeriodEnd);
      beforePeriodStart.setDate(beforePeriodStart.getDate() - 30);

      // Insert training record
      const { error } = await supabase.from("training_records").insert({
        team_identifier: teamIdentifier,
        issue_category: issueCategory,
        training_recommendation_id: trainingRecommendationId,
        training_completed_date: trainingDate,
        notes: notes || null,
        before_period_start: beforePeriodStart.toISOString().split("T")[0],
        before_period_end: beforePeriodEnd.toISOString().split("T")[0],
        before_occurrence_count: beforeMetrics.before_occurrence_count,
        before_total_impact: beforeMetrics.before_total_impact,
        before_avg_per_week: beforeMetrics.before_avg_per_week,
        // After metrics will be calculated later
        after_period_start: null,
        after_period_end: null,
        after_occurrence_count: null,
        after_total_impact: null,
        after_avg_per_week: null,
        occurrence_reduction_pct: null,
        impact_reduction_pct: null,
        effectiveness_rating: null,
        recorded_by: "System", // Could be enhanced to track actual user
      });

      if (error) {
        throw error;
      }

      toast.success("Training completion recorded successfully");
      onSuccess();
      onClose();
    } catch (err) {
      console.error("Error saving training record:", err);
      toast.error("Failed to save training record");
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
            Mark Training Completed
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close modal"
            disabled={saving}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Display Information */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 space-y-2">
            <div className="text-sm">
              <span className="text-gray-600 dark:text-gray-400">Team:</span>{" "}
              <span className="font-medium text-gray-900 dark:text-white">{teamIdentifier}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-600 dark:text-gray-400">Issue Category:</span>{" "}
              <span className="font-medium text-gray-900 dark:text-white">{issueCategory}</span>
            </div>
            {trainingRecommendation && (
              <div className="text-sm">
                <span className="text-gray-600 dark:text-gray-400">Training:</span>{" "}
                <span className="font-medium text-gray-900 dark:text-white">
                  {trainingRecommendation.training_title}
                </span>
              </div>
            )}
          </div>

          {/* Training Date */}
          <div>
            <label
              htmlFor="training-date"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              <Calendar className="h-4 w-4 inline mr-1" />
              Training Completed Date
            </label>
            <input
              type="date"
              id="training-date"
              value={trainingDate}
              onChange={(e) => setTrainingDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={saving}
              max={new Date().toISOString().split("T")[0]} // Can't be in the future
            />
          </div>

          {/* Notes */}
          <div>
            <label
              htmlFor="training-notes"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              <FileText className="h-4 w-4 inline mr-1" />
              Notes (Optional)
            </label>
            <textarea
              id="training-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Add any notes about the training session..."
              disabled={saving}
            />
          </div>

          {/* Info Message */}
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="text-xs text-blue-800 dark:text-blue-300">
              <strong>Note:</strong> Before metrics will be calculated from the 30 days prior to the training date. After metrics can be calculated later once 30 days have passed.
            </p>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors font-medium"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !trainingDate}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Saving...
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

