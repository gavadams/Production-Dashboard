import { supabase } from "./supabase";
import type { DowntimeEvent, SpoilageEvent, ProductionReport } from "./excelParser";

export interface SaveProductionDataResult {
  success: boolean;
  recordsCreated: {
    productionRuns: number;
    downtimeEvents: number;
    spoilageEvents: number;
  };
  errors: string[];
}

/**
 * Inserts a production run into the database
 * 
 * @param data - Production run data to insert
 * @returns The inserted record with id, or null if insertion failed
 * 
 * @example
 * const result = await insertProductionRun({
 *   press: "LP05",
 *   date: "06-11-2025",
 *   work_order_number: 62831205,
 *   good_production: 44,
 *   // ... other fields
 * });
 */
export async function insertProductionRun(data: {
  press: string;
  date: string; // DD-MM-YYYY format
  work_order_number: number | null;
  good_production: number | null;
  lhe: number | null;
  spoilage_percent: number | null;
  make_ready_start_time: string | null;
  make_ready_end_time: string | null;
  production_start_time: string | null;
  production_end_time: string | null;
  run_speed: number | null;
  shift: string | null;
  team: string | null;
  actual_line_hours: number | null;
  make_ready_time: number | null;
  downtime: number | null;
}): Promise<{ id: number } | null> {
  try {
    const { data: insertedData, error } = await supabase
      .from("production_runs")
      .insert({
        press: data.press,
        date: data.date,
        work_order_number: data.work_order_number,
        good_production: data.good_production,
        lhe: data.lhe,
        spoilage_percent: data.spoilage_percent,
        make_ready_start_time: data.make_ready_start_time,
        make_ready_end_time: data.make_ready_end_time,
        production_start_time: data.production_start_time,
        production_end_time: data.production_end_time,
        run_speed: data.run_speed,
        shift: data.shift,
        team: data.team,
        actual_line_hours: data.actual_line_hours,
        make_ready_time: data.make_ready_time,
        downtime: data.downtime,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Error inserting production run:", error);
      return null;
    }

    return insertedData as { id: number };
  } catch (error) {
    console.error("Exception inserting production run:", error);
    return null;
  }
}

/**
 * Inserts multiple downtime events linked to a production run
 * 
 * @param productionRunId - ID of the production run
 * @param downtimeArray - Array of downtime events to insert
 * @returns Count of inserted records, or 0 if insertion failed
 * 
 * @example
 * const count = await insertDowntimeEvents(123, [
 *   { category: "Changing Bulks", minutes: 24 },
 *   { category: "Camera Faults", minutes: 26 }
 * ]);
 */
export async function insertDowntimeEvents(
  productionRunId: number,
  downtimeArray: DowntimeEvent[]
): Promise<number> {
  if (!downtimeArray || downtimeArray.length === 0) {
    return 0;
  }

  try {
    const recordsToInsert = downtimeArray.map((event) => ({
      production_run_id: productionRunId,
      category: event.category,
      minutes: event.minutes,
    }));

    const { data, error } = await supabase
      .from("downtime_events")
      .insert(recordsToInsert)
      .select("id");

    if (error) {
      console.error("Error inserting downtime events:", error);
      return 0;
    }

    return data?.length || 0;
  } catch (error) {
    console.error("Exception inserting downtime events:", error);
    return 0;
  }
}

/**
 * Inserts multiple spoilage events linked to a production run
 * 
 * @param productionRunId - ID of the production run
 * @param spoilageArray - Array of spoilage events to insert
 * @returns Count of inserted records, or 0 if insertion failed
 * 
 * @example
 * const count = await insertSpoilageEvents(123, [
 *   { category: "Bulls Eyes/Marks in print", units: 3 },
 *   { category: "Start Up", units: 6 }
 * ]);
 */
export async function insertSpoilageEvents(
  productionRunId: number,
  spoilageArray: SpoilageEvent[]
): Promise<number> {
  if (!spoilageArray || spoilageArray.length === 0) {
    return 0;
  }

  try {
    const recordsToInsert = spoilageArray.map((event) => ({
      production_run_id: productionRunId,
      category: event.category,
      units: event.units,
    }));

    const { data, error } = await supabase
      .from("spoilage_events")
      .insert(recordsToInsert)
      .select("id");

    if (error) {
      console.error("Error inserting spoilage events:", error);
      return 0;
    }

    return data?.length || 0;
  } catch (error) {
    console.error("Exception inserting spoilage events:", error);
    return 0;
  }
}

/**
 * Checks if an upload already exists for a given press and date
 * Used to warn users before overwriting data
 * 
 * @param press - Press code (e.g., "LP05")
 * @param date - Date in DD-MM-YYYY format (e.g., "06-11-2025")
 * @returns Existing upload record or null if not found
 * 
 * @example
 * const existing = await checkExistingUpload("LP05", "06-11-2025");
 * if (existing) {
 *   console.warn("Upload already exists for this press and date");
 * }
 */
export async function checkExistingUpload(
  press: string,
  date: string
): Promise<{ id: number; filename: string; uploaded_at: string; status: string } | null> {
  try {
    const { data, error } = await supabase
      .from("upload_history")
      .select("id, filename, uploaded_at, status")
      .eq("press", press)
      .eq("date", date)
      .order("uploaded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Error checking existing upload:", error);
      return null;
    }

    return data || null;
  } catch (error) {
    console.error("Exception checking existing upload:", error);
    return null;
  }
}

/**
 * Saves parsed production data to the database
 * Processes all work orders and their associated downtime/spoilage events
 * 
 * @param report - Parsed production report from parseProductionReport()
 * @param uploadHistoryId - ID of the upload_history record to update
 * @returns Summary of saved records and any errors
 * 
 * @example
 * const report = await parseProductionReport(file, filename);
 * if (report) {
 *   const uploadHistory = await insertUploadHistory({...});
 *   if (uploadHistory) {
 *     const result = await saveProductionData(report, uploadHistory.id);
 *     console.log(`Saved ${result.recordsCreated.productionRuns} production runs`);
 *   }
 * }
 */
export async function saveProductionData(
  report: ProductionReport,
  uploadHistoryId: number
): Promise<SaveProductionDataResult> {
  const result: SaveProductionDataResult = {
    success: true,
    recordsCreated: {
      productionRuns: 0,
      downtimeEvents: 0,
      spoilageEvents: 0,
    },
    errors: [],
  };

  if (!report || !report.workOrders || report.workOrders.length === 0) {
    result.errors.push("No work orders to save");
    return result;
  }

  // Process each work order sequentially
  for (const workOrder of report.workOrders) {
    try {
      // Step 1: Insert production_run record
      const productionRunData = {
        press: report.press,
        date: report.date,
        work_order_number: workOrder.work_order_number,
        good_production: workOrder.good_production,
        lhe: workOrder.lhe,
        spoilage_percent: workOrder.spoilage_percent,
        make_ready_start_time: workOrder.make_ready.start_time,
        make_ready_end_time: workOrder.make_ready.end_time,
        production_start_time: workOrder.production.start_time,
        production_end_time: workOrder.production.end_time,
        run_speed: workOrder.run_speed,
        shift: workOrder.shift?.shift || null,
        team: workOrder.shift?.team || null,
        actual_line_hours: workOrder.shift?.actual_hours || null,
        make_ready_time: workOrder.shift?.make_ready_time || null,
        downtime: workOrder.shift?.downtime || null,
      };

      const productionRun = await insertProductionRun(productionRunData);

      if (!productionRun || !productionRun.id) {
        result.errors.push(
          `Failed to insert production run for work order ${workOrder.work_order_number || "unknown"}`
        );
        result.success = false;
        continue; // Skip this work order
      }

      result.recordsCreated.productionRuns++;

      const productionRunId = productionRun.id;

      // Step 2: Insert downtime events
      if (workOrder.downtime && workOrder.downtime.length > 0) {
        const downtimeCount = await insertDowntimeEvents(productionRunId, workOrder.downtime);
        result.recordsCreated.downtimeEvents += downtimeCount;

        if (downtimeCount === 0 && workOrder.downtime.length > 0) {
          result.errors.push(
            `Failed to insert downtime events for work order ${workOrder.work_order_number || "unknown"}`
          );
        }
      }

      // Step 3: Insert spoilage events
      if (workOrder.spoilage && workOrder.spoilage.length > 0) {
        const spoilageCount = await insertSpoilageEvents(productionRunId, workOrder.spoilage);
        result.recordsCreated.spoilageEvents += spoilageCount;

        if (spoilageCount === 0 && workOrder.spoilage.length > 0) {
          result.errors.push(
            `Failed to insert spoilage events for work order ${workOrder.work_order_number || "unknown"}`
          );
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(
        `Error processing work order ${workOrder.work_order_number || "unknown"}: ${errorMessage}`
      );
      result.success = false;
    }
  }

  // Step 4: Update upload_history with success status and counts
  try {
    const { error: updateError } = await supabase
      .from("upload_history")
      .update({
        status: result.success ? "completed" : "partial",
        error_message: result.errors.length > 0 ? result.errors.join("; ") : null,
        // Store counts in a JSON field or separate fields if your schema supports it
        // For now, we'll just update status and error_message
      })
      .eq("id", uploadHistoryId);

    if (updateError) {
      result.errors.push(`Failed to update upload history: ${updateError.message}`);
      result.success = false;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Exception updating upload history: ${errorMessage}`);
    result.success = false;
  }

  return result;
}

/**
 * Inserts upload history record
 * Handles duplicate key violations gracefully
 * 
 * @param uploadData - Upload history data to insert
 * @returns The inserted record with id, or null if insertion failed
 * 
 * @example
 * const result = await insertUploadHistory({
 *   filename: "857LP05_06-Nov-2025.xlsx",
 *   press: "LP05",
 *   date: "06-11-2025",
 *   uploaded_at: new Date().toISOString()
 * });
 */
export async function insertUploadHistory(uploadData: {
  filename: string;
  press: string;
  date: string; // DD-MM-YYYY format
  uploaded_at?: string;
  file_size?: number;
  status?: string;
  error_message?: string | null;
}): Promise<{ id: number } | null> {
  try {
    const { data: insertedData, error } = await supabase
      .from("upload_history")
      .insert({
        filename: uploadData.filename,
        press: uploadData.press,
        date: uploadData.date,
        uploaded_at: uploadData.uploaded_at || new Date().toISOString(),
        file_size: uploadData.file_size || null,
        status: uploadData.status || "completed",
        error_message: uploadData.error_message || null,
      })
      .select("id")
      .single();

    if (error) {
      // Check if it's a duplicate key violation
      if (error.code === "23505" || error.message.includes("duplicate") || error.message.includes("unique")) {
        console.warn("Upload history record already exists:", uploadData.filename);
        // Try to fetch the existing record
        const { data: existingData } = await supabase
          .from("upload_history")
          .select("id")
          .eq("filename", uploadData.filename)
          .single();

        if (existingData) {
          return existingData as { id: number };
        }
      }
      // Enhanced error logging
      console.error("Error inserting upload history:", {
        error,
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        uploadData,
      });
      throw new Error(
        `Failed to insert upload history: ${error.message}${error.details ? ` (${error.details})` : ""}${error.hint ? ` Hint: ${error.hint}` : ""}`
      );
    }

    return insertedData as { id: number };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Exception inserting upload history:", error);
    throw new Error(`Exception inserting upload history: ${errorMessage}`);
  }
}

