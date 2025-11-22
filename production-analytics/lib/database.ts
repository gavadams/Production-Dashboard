import { supabase } from "./supabase";
import type { DowntimeEvent, SpoilageEvent, ProductionReport } from "./excelParser";

/**
 * Helper function to calculate time difference in minutes
 * Converts HH:MM time strings to minutes and calculates difference
 * Handles times that cross midnight
 */
function timeDifferenceInMinutes(
  startTime: string | null,
  endTime: string | null
): number | null {
  if (!startTime || !endTime) {
    return null;
  }

  const timePattern = /^(\d{1,2}):(\d{2})$/;
  const startMatch = startTime.match(timePattern);
  const endMatch = endTime.match(timePattern);

  if (!startMatch || !endMatch) {
    return null;
  }

  const startHours = parseInt(startMatch[1], 10);
  const startMinutes = parseInt(startMatch[2], 10);
  const endHours = parseInt(endMatch[1], 10);
  const endMinutes = parseInt(endMatch[2], 10);

  const startTotalMinutes = startHours * 60 + startMinutes;
  const endTotalMinutes = endHours * 60 + endMinutes;

  // Handle case where end time is next day (e.g., 22:00 to 06:00)
  if (endTotalMinutes < startTotalMinutes) {
    return 1440 - startTotalMinutes + endTotalMinutes; // 1440 = minutes in a day
  }

  return endTotalMinutes - startTotalMinutes;
}

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
  date: string; // DD-MM-YYYY format (will be converted to DATE)
  work_order: string | null; // VARCHAR(20) in schema
  good_production: number | null;
  lhe_units: number | null; // DECIMAL(10,2) in schema
  spoilage_percentage: number | null; // DECIMAL(5,2) in schema
  shift_start_time: string | null; // TIME in schema
  shift_end_time: string | null; // TIME in schema
  make_ready_start_time: string | null; // TIME in schema
  make_ready_end_time: string | null; // TIME in schema
  make_ready_minutes: number | null; // INTEGER in schema
  production_start_time: string | null; // TIME in schema
  production_end_time: string | null; // TIME in schema
  production_minutes: number | null; // INTEGER in schema
  logged_downtime_minutes: number | null; // INTEGER in schema
  shift: string | null; // VARCHAR(20) in schema
  team: string | null; // VARCHAR(20) in schema
}): Promise<{ id: string } | null> {
  try {
    // Convert date from DD-MM-YYYY to YYYY-MM-DD for PostgreSQL DATE type
    const dateParts = data.date.split("-");
    const postgresDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

    const { data: insertedData, error } = await supabase
      .from("production_runs")
      .insert({
        press: data.press,
        date: postgresDate, // Convert to YYYY-MM-DD format
        work_order: data.work_order ? String(data.work_order) : null,
        good_production: data.good_production ?? 0,
        lhe_units: data.lhe_units ?? 0,
        spoilage_percentage: data.spoilage_percentage ?? 0,
        shift_start_time: data.shift_start_time,
        shift_end_time: data.shift_end_time,
        make_ready_start_time: data.make_ready_start_time,
        make_ready_end_time: data.make_ready_end_time,
        make_ready_minutes: data.make_ready_minutes ?? 0,
        production_start_time: data.production_start_time,
        production_end_time: data.production_end_time,
        production_minutes: data.production_minutes ?? 0,
        logged_downtime_minutes: data.logged_downtime_minutes ?? 0,
        shift: data.shift || "",
        team: data.team || "",
      })
      .select("id")
      .single();

    if (error) {
      console.error("Error inserting production run:", error);
      return null;
    }

    return insertedData as { id: string };
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
  productionRunId: string,
  downtimeArray: DowntimeEvent[],
  denormalizedData: {
    press: string;
    date: string; // DD-MM-YYYY format
    work_order: string | null;
    shift: string;
    team: string;
    team_identifier: string;
  }
): Promise<number> {
  if (!downtimeArray || downtimeArray.length === 0) {
    return 0;
  }

  try {
    // Convert date from DD-MM-YYYY to YYYY-MM-DD for PostgreSQL DATE type
    const dateParts = denormalizedData.date.split("-");
    const postgresDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

    const recordsToInsert = downtimeArray.map((event) => ({
      production_run_id: productionRunId,
      press: denormalizedData.press,
      date: postgresDate,
      work_order: denormalizedData.work_order ? String(denormalizedData.work_order) : null,
      shift: denormalizedData.shift,
      team: denormalizedData.team,
      team_identifier: denormalizedData.team_identifier,
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
  productionRunId: string,
  spoilageArray: SpoilageEvent[],
  denormalizedData: {
    press: string;
    date: string; // DD-MM-YYYY format
    work_order: string | null;
    shift: string;
    team: string;
    team_identifier: string;
  }
): Promise<number> {
  if (!spoilageArray || spoilageArray.length === 0) {
    return 0;
  }

  try {
    // Convert date from DD-MM-YYYY to YYYY-MM-DD for PostgreSQL DATE type
    const dateParts = denormalizedData.date.split("-");
    const postgresDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

    const recordsToInsert = spoilageArray.map((event) => ({
      production_run_id: productionRunId,
      press: denormalizedData.press,
      date: postgresDate,
      work_order: denormalizedData.work_order ? String(denormalizedData.work_order) : null,
      shift: denormalizedData.shift,
      team: denormalizedData.team,
      team_identifier: denormalizedData.team_identifier,
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
): Promise<{ id: string; filename: string; uploaded_at: string; status: string } | null> {
  try {
    // Convert date from DD-MM-YYYY to YYYY-MM-DD for PostgreSQL DATE type
    const dateParts = date.split("-");
    const postgresDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

    const { data, error } = await supabase
      .from("upload_history")
      .select("id, filename, uploaded_at, status")
      .eq("press", press)
      .eq("date", postgresDate)
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
  uploadHistoryId: string
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
      // Calculate make_ready_minutes and production_minutes from times
      const makeReadyMinutes = workOrder.make_ready.start_time && workOrder.make_ready.end_time
        ? timeDifferenceInMinutes(workOrder.make_ready.start_time, workOrder.make_ready.end_time)
        : null;
      
      const productionMinutes = workOrder.production.start_time && workOrder.production.end_time
        ? timeDifferenceInMinutes(workOrder.production.start_time, workOrder.production.end_time)
        : null;

      // Calculate total downtime minutes from downtime events
      const totalDowntimeMinutes = workOrder.downtime?.reduce(
        (sum, event) => sum + (event.minutes || 0),
        0
      ) || 0;

      const shift = workOrder.shift?.shift || "";
      const team = workOrder.shift?.team || "";
      const teamIdentifier = `${report.press}_${shift}_${team}`;

      const productionRunData = {
        press: report.press,
        date: report.date,
        work_order: workOrder.work_order_number ? String(workOrder.work_order_number) : null,
        good_production: workOrder.good_production,
        lhe_units: workOrder.lhe,
        spoilage_percentage: workOrder.spoilage_percent,
        shift_start_time: workOrder.shift?.start_time || null,
        shift_end_time: workOrder.shift?.end_time || null,
        make_ready_start_time: workOrder.make_ready.start_time,
        make_ready_end_time: workOrder.make_ready.end_time,
        make_ready_minutes: makeReadyMinutes,
        production_start_time: workOrder.production.start_time,
        production_end_time: workOrder.production.end_time,
        production_minutes: productionMinutes,
        logged_downtime_minutes: totalDowntimeMinutes,
        shift: shift,
        team: team,
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

      // Step 2: Insert downtime events with denormalized data
      if (workOrder.downtime && workOrder.downtime.length > 0) {
        const downtimeCount = await insertDowntimeEvents(
          productionRunId,
          workOrder.downtime,
          {
            press: report.press,
            date: report.date,
            work_order: workOrder.work_order_number ? String(workOrder.work_order_number) : null,
            shift: shift,
            team: team,
            team_identifier: teamIdentifier,
          }
        );
        result.recordsCreated.downtimeEvents += downtimeCount;

        if (downtimeCount === 0 && workOrder.downtime.length > 0) {
          result.errors.push(
            `Failed to insert downtime events for work order ${workOrder.work_order_number || "unknown"}`
          );
        }
      }

      // Step 3: Insert spoilage events with denormalized data
      if (workOrder.spoilage && workOrder.spoilage.length > 0) {
        const spoilageCount = await insertSpoilageEvents(
          productionRunId,
          workOrder.spoilage,
          {
            press: report.press,
            date: report.date,
            work_order: workOrder.work_order_number ? String(workOrder.work_order_number) : null,
            shift: shift,
            team: team,
            team_identifier: teamIdentifier,
          }
        );
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
    const updateData: Record<string, unknown> = {
      status: result.success ? "success" : result.recordsCreated.productionRuns > 0 ? "partial" : "failed",
      records_created: result.recordsCreated.productionRuns,
      downtime_records: result.recordsCreated.downtimeEvents,
      spoilage_records: result.recordsCreated.spoilageEvents,
      error_log: result.errors.length > 0 ? result.errors.join("; ") : null,
    };

    const { error: updateError } = await supabase
      .from("upload_history")
      .update(updateData)
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
  status?: string;
  records_created?: number;
  downtime_records?: number;
  spoilage_records?: number;
  error_log?: string | null;
}): Promise<{ id: string } | null> {
  try {
    // Convert date from DD-MM-YYYY to YYYY-MM-DD for PostgreSQL DATE type
    const dateParts = uploadData.date.split("-");
    const postgresDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

    // Build insert object with only columns that exist in the schema
    const insertData: Record<string, unknown> = {
      filename: uploadData.filename,
      press: uploadData.press,
      date: postgresDate,
      uploaded_at: uploadData.uploaded_at || new Date().toISOString(),
      status: uploadData.status || "success",
      records_created: uploadData.records_created ?? 0,
      downtime_records: uploadData.downtime_records ?? 0,
      spoilage_records: uploadData.spoilage_records ?? 0,
      error_log: uploadData.error_log || null,
    };

    // Only include columns that exist in your schema
    // Omit file_size and error_message if they don't exist in your table

    const { data: insertedData, error } = await supabase
      .from("upload_history")
      .insert(insertData)
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
          return existingData as { id: string };
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

    return insertedData as { id: string };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Exception inserting upload history:", error);
    throw new Error(`Exception inserting upload history: ${errorMessage}`);
  }
}

