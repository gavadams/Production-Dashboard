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
  team_identifier?: string; // Optional: constructed as press_shift_team
}): Promise<{ id: string } | null> {
  try {
    // Convert date from DD-MM-YYYY to YYYY-MM-DD for PostgreSQL DATE type
    const dateParts = data.date.split("-");
    const postgresDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

    // Construct team_identifier if not provided: press_shift_team
    // This ensures each press/line has separate team analysis
    const shiftValue = data.shift || "";
    const teamValue = data.team || "";
    const teamIdentifier = data.team_identifier || `${data.press}_${shiftValue}_${teamValue}`;

    // Build insert object - include team_identifier to ensure proper grouping
    // If team_identifier column doesn't exist in schema, this will fail at runtime
    // and we'll know to add the column via migration
    const insertPayload: Record<string, unknown> = {
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
      shift: shiftValue,
      team: teamValue,
      team_identifier: teamIdentifier, // Include to ensure proper grouping by press+shift+team
    };

    const { data: insertedData, error } = await supabase
      .from("production_runs")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error) {
      // Check if it's a duplicate key violation
      if (error.code === "23505" || error.message.includes("duplicate") || error.message.includes("unique")) {
        console.warn("Production run already exists:", {
          press: data.press,
          date: data.date,
          work_order: data.work_order,
          shift: data.shift,
          team: data.team,
        });
        // Try to fetch the existing record
        const { data: existingData } = await supabase
          .from("production_runs")
          .select("id")
          .eq("press", data.press)
          .eq("date", postgresDate)
          .eq("work_order", data.work_order || "")
          .eq("shift", data.shift || "")
          .eq("team", data.team || "")
          .maybeSingle();

        if (existingData) {
          return existingData as { id: string };
        }
      }
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
      
      // Ensure shift and team are not empty strings (use null instead)
      const shiftValue = shift && shift.trim() !== "" ? shift.trim() : null;
      const teamValue = team && team.trim() !== "" ? team.trim() : null;
      
      // Construct team_identifier: press_shift_team (e.g., "LP05_Earlies_A")
      // This ensures each press/line has separate team analysis
      // If team is missing, log a warning but still construct identifier
      if (!teamValue) {
        console.warn(`Work order ${workOrder.work_order_number || "unknown"} has no team assigned. Shift: ${shiftValue || "unknown"}, Press: ${report.press}`);
      }
      
      const teamIdentifier = `${report.press}_${shiftValue || "Unknown"}_${teamValue || "Unknown"}`;

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
        shift: shiftValue || "", // Schema requires NOT NULL, so use empty string if null
        team: teamValue || "", // Schema requires NOT NULL, so use empty string if null
        team_identifier: teamIdentifier, // Pass team_identifier to ensure proper grouping
      };

      const productionRun = await insertProductionRun(productionRunData);

      if (!productionRun || !productionRun.id) {
        // If it's a duplicate, it's not really an error - just skip
        result.errors.push(
          `Skipped production run for work order ${workOrder.work_order_number || "unknown"} - may already exist`
        );
        // Don't mark as failure for duplicates - continue processing other work orders
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

export interface DailyProductionRecord {
  press: string;
  date: string; // DD-MM-YYYY format
  total_production: number;
  avg_run_speed: number;
  avg_spoilage_pct: number;
  efficiency_pct: number;
}

/**
 * Gets daily production summary for a specific date
 * Queries the daily_production_summary view
 * 
 * @param date - Date in DD-MM-YYYY format (e.g., "06-11-2025")
 * @returns Array of DailyProductionRecord objects, or empty array if no data found
 * 
 * @example
 * const records = await getDailyProduction("06-11-2025");
 * records.forEach(record => {
 *   console.log(`${record.press}: ${record.total_production} units`);
 * });
 */
export async function getDailyProduction(
  date: string
): Promise<DailyProductionRecord[]> {
  try {
    // Convert date from DD-MM-YYYY to YYYY-MM-DD for PostgreSQL DATE type
    const dateParts = date.split("-");
    if (dateParts.length !== 3) {
      console.error("Invalid date format. Expected DD-MM-YYYY, got:", date);
      return [];
    }
    const postgresDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

    const { data, error } = await supabase
      .from("daily_production_summary")
      .select("press, date, total_production, avg_run_speed, avg_spoilage_pct, efficiency_pct")
      .eq("date", postgresDate)
      .order("press", { ascending: true });

    if (error) {
      console.error("Error fetching daily production:", error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Convert date back to DD-MM-YYYY format and map to return type
    return data.map((record) => {
      // Convert date from YYYY-MM-DD back to DD-MM-YYYY
      const recordDate = new Date(record.date);
      const day = String(recordDate.getDate()).padStart(2, "0");
      const month = String(recordDate.getMonth() + 1).padStart(2, "0");
      const year = recordDate.getFullYear();
      const formattedDate = `${day}-${month}-${year}`;

      return {
        press: record.press,
        date: formattedDate,
        total_production: record.total_production || 0,
        avg_run_speed: record.avg_run_speed || 0,
        avg_spoilage_pct: record.avg_spoilage_pct || 0,
        efficiency_pct: record.efficiency_pct || 0,
      };
    });
  } catch (error) {
    console.error("Exception fetching daily production:", error);
    return [];
  }
}

export interface TopDowntimeIssue {
  category: string;
  total_minutes: number;
  presses: string[];
  occurrence_count: number;
}

/**
 * Gets top downtime issues for a specific date
 * Groups downtime events by category and aggregates minutes
 * 
 * @param date - Date in DD-MM-YYYY format (e.g., "06-11-2025")
 * @param limit - Maximum number of issues to return (default: 5)
 * @returns Array of TopDowntimeIssue objects, sorted by total minutes descending
 * 
 * @example
 * const issues = await getTopDowntimeIssues("06-11-2025", 5);
 * issues.forEach(issue => {
 *   console.log(`${issue.category}: ${issue.total_minutes} minutes`);
 * });
 */
export async function getTopDowntimeIssues(
  date: string,
  limit: number = 5
): Promise<TopDowntimeIssue[]> {
  try {
    // Convert date from DD-MM-YYYY to YYYY-MM-DD for PostgreSQL DATE type
    const dateParts = date.split("-");
    if (dateParts.length !== 3) {
      console.error("Invalid date format. Expected DD-MM-YYYY, got:", date);
      return [];
    }
    const postgresDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

    const { data, error } = await supabase
      .from("downtime_events")
      .select("category, minutes, press")
      .eq("date", postgresDate)
      .order("minutes", { ascending: false });

    if (error) {
      console.error("Error fetching downtime issues:", error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Group by category and aggregate
    const categoryMap = new Map<string, {
      total_minutes: number;
      presses: Set<string>;
      occurrence_count: number;
    }>();

    data.forEach((event) => {
      const category = event.category || "Unknown";
      const minutes = event.minutes || 0;
      const press = event.press || "";

      if (!categoryMap.has(category)) {
        categoryMap.set(category, {
          total_minutes: 0,
          presses: new Set<string>(),
          occurrence_count: 0,
        });
      }

      const categoryData = categoryMap.get(category)!;
      categoryData.total_minutes += minutes;
      if (press) {
        categoryData.presses.add(press);
      }
      categoryData.occurrence_count += 1;
    });

    // Convert to array and sort by total_minutes descending
    const issues: TopDowntimeIssue[] = Array.from(categoryMap.entries())
      .map(([category, data]) => ({
        category,
        total_minutes: data.total_minutes,
        presses: Array.from(data.presses).sort(),
        occurrence_count: data.occurrence_count,
      }))
      .sort((a, b) => b.total_minutes - a.total_minutes)
      .slice(0, limit);

    return issues;
  } catch (error) {
    console.error("Exception fetching top downtime issues:", error);
    return [];
  }
}

export interface TeamPerformanceData {
  press: string;
  shift: string;
  team: string;
  team_identifier: string;
  total_runs: number;
  total_production: number;
  avg_run_speed: number;
  avg_make_ready_minutes: number;
  avg_spoilage_pct: number;
}

/**
 * Gets team performance data with optional filters
 * Queries production_runs table and groups by team_identifier
 * 
 * @param filters - Filter options for the query
 * @returns Array of TeamPerformanceData objects, ordered by avg_run_speed DESC
 * 
 * @example
 * const teams = await getTeamPerformance({
 *   press: "LP05",
 *   shift: "Earlies",
 *   startDate: "2025-11-01",
 *   endDate: "2025-11-30"
 * });
 */
export async function getTeamPerformance(filters: {
  press?: string;
  shift?: string;
  team?: string; // Added team filter
  startDate: string; // YYYY-MM-DD format
  endDate: string; // YYYY-MM-DD format
}): Promise<TeamPerformanceData[]> {
  try {
    // Select all needed fields
    // Note: team_identifier will be constructed in code as press_shift_team
    // to ensure proper separation of teams across different presses/lines
    let query = supabase
      .from("production_runs")
      .select("press, shift, team, calculated_run_speed, make_ready_minutes, spoilage_percentage, good_production")
      .gte("date", filters.startDate)
      .lte("date", filters.endDate);

    // Apply filters
    if (filters.press) {
      query = query.eq("press", filters.press);
    }

    if (filters.shift) {
      query = query.eq("shift", filters.shift);
    }

    if (filters.team) {
      query = query.eq("team", filters.team);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching team performance:", error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Group by team_identifier and calculate aggregations
    const teamMap = new Map<string, {
      press: string;
      shift: string;
      team: string;
      team_identifier: string;
      runs: number;
      total_production: number;
      run_speeds: number[];
      make_ready_minutes: number[];
      spoilage_percentages: number[];
    }>();

    data.forEach((record) => {
      // Always construct team_identifier as press_shift_team to ensure proper separation
      // This ensures each press/line has separate team analysis
      // Format: "LP05_Earlies_TeamA" - unique per press, shift, and team combination
      // We always construct it here rather than reading from DB to ensure consistency
      const teamId = `${record.press}_${record.shift || ""}_${record.team || ""}`;
      
      if (!teamMap.has(teamId)) {
        teamMap.set(teamId, {
          press: record.press as string,
          shift: record.shift as string,
          team: record.team as string,
          team_identifier: teamId,
          runs: 0,
          total_production: 0,
          run_speeds: [],
          make_ready_minutes: [],
          spoilage_percentages: [],
        });
      }

      const teamData = teamMap.get(teamId)!;
      teamData.runs += 1;
      teamData.total_production += (record.good_production as number) || 0;

      const runSpeed = (record.calculated_run_speed as number) || 0;
      if (runSpeed > 0) {
        teamData.run_speeds.push(runSpeed);
      }

      const makeReady = (record.make_ready_minutes as number) ?? null;
      if (makeReady !== null && makeReady !== undefined) {
        teamData.make_ready_minutes.push(makeReady);
      }

      const spoilagePct = (record.spoilage_percentage as number) ?? null;
      if (spoilagePct !== null && spoilagePct !== undefined) {
        teamData.spoilage_percentages.push(spoilagePct);
      }
    });

    // Calculate averages and create result array
    const results: TeamPerformanceData[] = Array.from(teamMap.values()).map((teamData) => {
      const avg_run_speed =
        teamData.run_speeds.length > 0
          ? teamData.run_speeds.reduce((sum, speed) => sum + speed, 0) / teamData.run_speeds.length
          : 0;

      const avg_make_ready_minutes =
        teamData.make_ready_minutes.length > 0
          ? teamData.make_ready_minutes.reduce((sum, minutes) => sum + minutes, 0) / teamData.make_ready_minutes.length
          : 0;

      const avg_spoilage_pct =
        teamData.spoilage_percentages.length > 0
          ? teamData.spoilage_percentages.reduce((sum, pct) => sum + pct, 0) / teamData.spoilage_percentages.length
          : 0;

      return {
        press: teamData.press,
        shift: teamData.shift,
        team: teamData.team,
        team_identifier: teamData.team_identifier,
        total_runs: teamData.runs,
        total_production: teamData.total_production,
        avg_run_speed,
        avg_make_ready_minutes,
        avg_spoilage_pct,
      };
    });

    // Sort by avg_run_speed DESC
    results.sort((a, b) => b.avg_run_speed - a.avg_run_speed);

    return results;
  } catch (error) {
    console.error("Exception fetching team performance:", error);
    return [];
  }
}

export interface TeamTrainingNeed {
  team_identifier: string;
  press: string;
  shift: string;
  team: string;
  issue_type: string;
  issue_category: string;
  occurrence_count: number;
  total_impact: number;
  avg_impact: number;
}

interface TeamTrainingNeedRaw {
  team_identifier?: string | null;
  press?: string | null;
  shift?: string | null;
  team?: string | null;
  issue_type?: string | null;
  issue_category?: string | null;
  occurrence_count?: number | null;
  total_impact?: number | null;
  avg_impact?: number | null;
}

/**
 * Gets team training needs using the Supabase RPC function
 * Identifies teams with repeated spoilage or downtime issues
 * 
 * @param daysLookback - Number of days to look back (default: 30)
 * @param minOccurrences - Minimum occurrences to flag (default: 3)
 * @returns Array of TeamTrainingNeed objects
 * 
 * @example
 * const trainingNeeds = await getTeamTrainingNeeds(30, 3);
 * trainingNeeds.forEach(need => {
 *   console.log(`${need.team_identifier}: ${need.issue_category}`);
 * });
 */
export async function getTeamTrainingNeeds(
  daysLookback: number = 30,
  minOccurrences: number = 3
): Promise<TeamTrainingNeed[]> {
  try {
    const { data, error } = await supabase.rpc("get_team_training_needs", {
      days_lookback: daysLookback,
      min_occurrences: minOccurrences,
    });

    if (error) {
      console.error("Error fetching team training needs:", error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    return (data as TeamTrainingNeedRaw[]).map((record) => ({
      team_identifier: record.team_identifier || "",
      press: record.press || "",
      shift: record.shift || "",
      team: record.team || "",
      issue_type: record.issue_type || "",
      issue_category: record.issue_category || "",
      occurrence_count: record.occurrence_count || 0,
      total_impact: record.total_impact || 0,
      avg_impact: record.avg_impact || 0,
    }));
  } catch (error) {
    console.error("Exception fetching team training needs:", error);
    return [];
  }
}

/**
 * Gets recommended training based on issue category
 * 
 * @param category - Issue category name
 * @returns Recommended training string
 */
export function getTrainingRecommendation(category: string): string {
  const categoryLower = category.toLowerCase();
  
  // Mapping of categories to training recommendations
  const trainingMap: Record<string, string> = {
    "camera faults": "Camera calibration and troubleshooting training",
    "camera": "Camera calibration and troubleshooting training",
    "damaged edges": "Material handling and quality control training",
    "damaged edges/bent corner": "Material handling and quality control training",
    "bent corner": "Material handling and quality control training",
    "pimples": "Cylinder maintenance and cleaning procedures",
    "blanket change": "Blanket replacement and maintenance training",
    "blanket / packing change": "Blanket replacement and maintenance training",
    "changing bulks": "Bulk change procedures and efficiency training",
    "coating": "Coating application and quality control training",
    "coating drips": "Coating application and quality control training",
    "varnish": "Varnish application and maintenance training",
    "varnish fail": "Varnish troubleshooting and maintenance training",
    "mechanical breakdown": "Mechanical troubleshooting and preventive maintenance",
    "repro error": "Repro and plate preparation training",
    "repro error / plates": "Repro and plate preparation training",
    "start up": "Startup procedures and efficiency training",
    "setting up": "Setup procedures and efficiency training",
    "crash at feeder": "Feeder operation and troubleshooting training",
    "impression cylinder wash": "Cylinder maintenance and cleaning procedures",
    "grippers": "Gripper maintenance and adjustment training",
  };

  // Try exact match first
  if (trainingMap[categoryLower]) {
    return trainingMap[categoryLower];
  }

  // Try partial matches
  for (const [key, value] of Object.entries(trainingMap)) {
    if (categoryLower.includes(key) || key.includes(categoryLower)) {
      return value;
    }
  }

  // Default recommendation
  return `Training on ${category} prevention and troubleshooting`;
}

