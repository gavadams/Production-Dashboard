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
      team_identifier?: string; // Optional: constructed as press_team (e.g., "LP05_A")
}): Promise<{ id: string } | null> {
  try {
    // Convert date from DD-MM-YYYY to YYYY-MM-DD for PostgreSQL DATE type
    const dateParts = data.date.split("-");
    const postgresDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

    // Construct team_identifier if not provided: press_shift_team
    // This ensures each press/line has separate team analysis
    const shiftValue = data.shift || "";
    const teamValue = data.team || "";
    // team_identifier is just press_team (e.g., "LP05_A"), not press_shift_team
    const teamIdentifier = data.team_identifier || `${data.press}_${teamValue}`;

    // Build insert object - include team_identifier to ensure proper grouping
    // Note: team_identifier might be a generated column, so we'll try with it first
    // and fall back if needed
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
    };
    
    // Only include team_identifier if it's not a generated column
    // The error "cannot insert a non-DEFAULT value" suggests it might be generated
    // Try without it first, or only include if we know it's not generated
    // For now, we'll try with it and fall back if needed
    // team_identifier format: press_team (e.g., "LP05_A")
    if (teamIdentifier && teamIdentifier !== `${data.press}_Unknown`) {
      insertPayload.team_identifier = teamIdentifier;
    }

    // Try inserting with team_identifier first
    let { data: insertedData, error } = await supabase
      .from("production_runs")
      .insert(insertPayload)
      .select("id")
      .single();

    // If error is due to team_identifier column (missing, generated, or constraint issue), try without it
    if (error && (error.message.includes("team_identifier") || error.code === "42703" || error.code === "42804")) {
      console.warn("team_identifier column issue, inserting without it:", error.message);
      // Remove team_identifier from payload and try again
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { team_identifier: _, ...payloadWithoutTeamId } = insertPayload;
      const retryResult = await supabase
        .from("production_runs")
        .insert(payloadWithoutTeamId)
        .select("id")
        .single();
      
      insertedData = retryResult.data;
      error = retryResult.error;
    }

    if (error) {
      // Check if it's a duplicate key violation
      if (error.code === "23505" || error.message.includes("duplicate") || error.message.includes("unique")) {
        console.warn("Production run duplicate detected:", {
          press: data.press,
          date: data.date,
          work_order: data.work_order,
          shift: data.shift,
          team: data.team,
          error: error.message,
        });
        
        // For duplicate work orders with different teams, we should still insert them
        // The unique constraint should be on (press, date, work_order, shift, team)
        // If shift and team are different, it's not a duplicate - throw error to be handled by caller
        if (data.shift && data.team && (data.shift.trim() !== "" || data.team.trim() !== "")) {
          // This is a valid duplicate (same work order, same shift/team) - return existing
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
            console.log("Found existing record for duplicate:", existingData.id);
            return existingData as { id: string };
          }
        }
        
        // If shift/team are empty, this might be a real duplicate - still try to find it
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
      console.error("Insert payload was:", JSON.stringify(insertPayload, null, 2));
      // Throw error so it can be caught and handled by caller
      throw new Error(`Failed to insert production run: ${error.message} (Code: ${error.code || "unknown"})`);
    }

    if (!insertedData || !insertedData.id) {
      console.error("Insert succeeded but no data returned");
      throw new Error("Insert succeeded but no ID returned from database");
    }

    return insertedData as { id: string };
  } catch (error) {
    // Re-throw the error so caller can handle it properly
    console.error("Exception inserting production run:", error);
    throw error;
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
    result.success = false;
    return result;
  }

  console.log(`Starting to save ${report.workOrders.length} work orders for ${report.press} on ${report.date}`);

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

      // Calculate total downtime minutes from PRODUCTION downtime events only
      // Make-ready downtime should NOT be included in logged_downtime_minutes for run speed calculation
      const totalDowntimeMinutes = workOrder.productionDowntime?.reduce(
        (sum, event) => sum + (event.minutes || 0),
        0
      ) || 0;

      // Extract shift and team from the assigned shift
      const assignedShift = workOrder.shift;
      const shift = assignedShift?.shift || "";
      const team = assignedShift?.team || "";
      
      // Ensure shift and team are not empty strings (use null instead)
      const shiftValue = shift && shift.trim() !== "" ? shift.trim() : null;
      const teamValue = team && team.trim() !== "" ? team.trim() : null;
      
      // Construct team_identifier: press_team (e.g., "LP05_A")
      // This ensures each press/line has separate team analysis
      // Note: We don't include shift in team_identifier - teams are analyzed across all shifts
      // If team is missing, log a warning but still construct identifier
      if (!teamValue) {
        console.warn(`Work order ${workOrder.work_order_number || "unknown"} has no team assigned.`, {
          shift: shiftValue,
          team: teamValue,
          assignedShift: assignedShift,
          productionTime: `${workOrder.production.start_time} - ${workOrder.production.end_time}`,
          press: report.press,
        });
      }
      
      // team_identifier format: press_team (e.g., "LP05_A") - NOT including shift
      const teamIdentifier = `${report.press}_${teamValue || "Unknown"}`;
      
      console.log(`Constructing team_identifier for WO ${workOrder.work_order_number}:`, {
        press: report.press,
        team: teamValue,
        shift: shiftValue,
        team_identifier: teamIdentifier
      });

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

      let productionRun;
      try {
        console.log(`Attempting to insert production run for work order ${workOrder.work_order_number}:`, {
          press: productionRunData.press,
          date: productionRunData.date,
          work_order: productionRunData.work_order,
          shift: productionRunData.shift,
          team: productionRunData.team,
          team_identifier: productionRunData.team_identifier,
        });
        
        productionRun = await insertProductionRun(productionRunData);
        
        if (!productionRun || !productionRun.id) {
          // This shouldn't happen if insertProductionRun throws on error, but handle it just in case
          result.errors.push(
            `Insert returned null for work order ${workOrder.work_order_number || "unknown"} - no ID returned`
          );
          result.success = false;
          console.error("Insert returned null for work order:", workOrder.work_order_number);
          continue; // Skip this work order
        }
      } catch (insertError) {
        const errorMessage = insertError instanceof Error ? insertError.message : String(insertError);
        result.errors.push(
          `Failed to insert production run for work order ${workOrder.work_order_number || "unknown"}: ${errorMessage}`
        );
        result.success = false;
        console.error("Error inserting production run:", insertError);
        console.error("Work order data:", JSON.stringify(productionRunData, null, 2));
        continue; // Skip this work order
      }

      result.recordsCreated.productionRuns++;
      console.log(`Successfully inserted production run ${productionRun.id} for work order ${workOrder.work_order_number}`);

      const productionRunId = productionRun.id;

      // Step 2: Insert downtime events with denormalized data
      console.log(`Work order ${workOrder.work_order_number}: ${workOrder.downtime?.length || 0} downtime events, ${workOrder.spoilage?.length || 0} spoilage events`);
      if (workOrder.downtime && workOrder.downtime.length > 0) {
        console.log(`Inserting ${workOrder.downtime.length} downtime events for work order ${workOrder.work_order_number}`);
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
        console.log(`Inserted ${downtimeCount} downtime events for work order ${workOrder.work_order_number}`);

        if (downtimeCount === 0 && workOrder.downtime.length > 0) {
          result.errors.push(
            `Failed to insert downtime events for work order ${workOrder.work_order_number || "unknown"}`
          );
        }
      } else {
        console.log(`No downtime events to insert for work order ${workOrder.work_order_number}`);
      }

      // Step 3: Insert spoilage events with denormalized data
      if (workOrder.spoilage && workOrder.spoilage.length > 0) {
        console.log(`Inserting ${workOrder.spoilage.length} spoilage events for work order ${workOrder.work_order_number}`);
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
        console.log(`Inserted ${spoilageCount} spoilage events for work order ${workOrder.work_order_number}`);

        if (spoilageCount === 0 && workOrder.spoilage.length > 0) {
          result.errors.push(
            `Failed to insert spoilage events for work order ${workOrder.work_order_number || "unknown"}`
          );
        }
      } else {
        console.log(`No spoilage events to insert for work order ${workOrder.work_order_number}`);
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

  // Log final summary
  console.log(`Finished saving production data. Summary:`, {
    totalWorkOrders: report.workOrders.length,
    productionRunsCreated: result.recordsCreated.productionRuns,
    downtimeEventsCreated: result.recordsCreated.downtimeEvents,
    spoilageEventsCreated: result.recordsCreated.spoilageEvents,
    errors: result.errors.length,
    success: result.success,
  });

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
    // Note: team_identifier will be constructed in code as press_team (e.g., "LP05_A")
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
      // Always construct team_identifier as press_team to ensure proper separation
      // This ensures each press/line has separate team analysis
      // Format: "LP05_A" - unique per press and team combination (not including shift)
      // We always construct it here rather than reading from DB to ensure consistency
      const teamId = `${record.press}_${record.team || ""}`;
      
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

export interface DowntimeTrend {
  press: string;
  category: string;
  week_start_date: string; // YYYY-MM-DD format
  total_minutes: number;
  pct_change: number; // Week-over-week percentage change
  previous_week_minutes: number;
}

/**
 * Gets downtime trends by calling the get_downtime_trends Supabase function
 * Returns week-over-week percentage changes for downtime categories
 * 
 * @param filters - Filter options for the query
 * @returns Array of DowntimeTrend objects, filtered to show only increasing trends (pct_change > 0)
 * 
 * @example
 * const trends = await getDowntimeTrends({
 *   press: "LP05",
 *   weeksLookback: 8
 * });
 */
export async function getDowntimeTrends(filters: {
  press?: string;
  weeksLookback?: number;
}): Promise<DowntimeTrend[]> {
  try {
    const weeksLookback = filters.weeksLookback ?? 8;

    // Prepare parameters for the RPC function
    const rpcParams: {
      press_filter?: string;
      weeks_lookback: number;
    } = {
      weeks_lookback: weeksLookback,
    };

    if (filters.press) {
      rpcParams.press_filter = filters.press;
    }

    // Call the Supabase RPC function
    const { data, error } = await supabase.rpc("get_downtime_trends", rpcParams);

    if (error) {
      console.error("Error calling get_downtime_trends RPC function:", error);
      return [];
    }

    if (!data || !Array.isArray(data)) {
      return [];
    }

    // Map the raw RPC response to DowntimeTrend interface
    // Filter to show only increasing trends (pct_change > 0)
    const trends: DowntimeTrend[] = data
      .filter((item: unknown) => {
        // Type guard to ensure item has the expected structure
        if (typeof item !== "object" || item === null) {
          return false;
        }
        const trendItem = item as Record<string, unknown>;
        const pctChange = typeof trendItem.pct_change === "number" ? trendItem.pct_change : 0;
        // Only include trends with positive percentage change (increasing)
        return pctChange > 0;
      })
      .map((item: unknown) => {
        const trendItem = item as Record<string, unknown>;
        return {
          press: String(trendItem.press || ""),
          category: String(trendItem.category || ""),
          week_start_date: String(trendItem.week_start_date || ""),
          total_minutes: typeof trendItem.total_minutes === "number" ? trendItem.total_minutes : 0,
          pct_change: typeof trendItem.pct_change === "number" ? trendItem.pct_change : 0,
          previous_week_minutes:
            typeof trendItem.previous_week_minutes === "number" ? trendItem.previous_week_minutes : 0,
        } as DowntimeTrend;
      });

    // Sort by pct_change descending (largest increases first)
    trends.sort((a, b) => b.pct_change - a.pct_change);

    return trends;
  } catch (error) {
    console.error("Exception calling get_downtime_trends RPC function:", error);
    return [];
  }
}

export interface MaintenanceAlert {
  press: string;
  category: string;
  current_week_minutes: number;
  trend_pct: number; // Percentage change from previous week
  severity: "urgent" | "warning" | "monitor";
  recommendation: string;
}

/**
 * Gets maintenance alerts based on downtime events
 * Compares current week with previous week to identify trends
 * Categorizes alerts by severity based on minutes and trend
 * 
 * @param filters - Filter options for the query
 * @returns Array of MaintenanceAlert objects, ordered by severity and minutes
 * 
 * @example
 * const alerts = await getMaintenanceAlerts({
 *   press: "LP05"
 * });
 */
export async function getMaintenanceAlerts(filters: {
  press?: string;
}): Promise<MaintenanceAlert[]> {
  try {
    // Calculate date ranges for current week and previous week
    const today = new Date();
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - today.getDay()); // Start of current week (Sunday)
    currentWeekStart.setHours(0, 0, 0, 0);
    
    const currentWeekEnd = new Date(currentWeekStart);
    currentWeekEnd.setDate(currentWeekStart.getDate() + 6); // End of current week (Saturday)
    currentWeekEnd.setHours(23, 59, 59, 999);
    
    const previousWeekStart = new Date(currentWeekStart);
    previousWeekStart.setDate(currentWeekStart.getDate() - 7);
    
    const previousWeekEnd = new Date(currentWeekStart);
    previousWeekEnd.setDate(currentWeekStart.getDate() - 1);
    previousWeekEnd.setHours(23, 59, 59, 999);

    // Format dates for PostgreSQL
    const formatDate = (date: Date) => date.toISOString().split("T")[0];
    const currentWeekStartStr = formatDate(currentWeekStart);
    const currentWeekEndStr = formatDate(currentWeekEnd);
    const previousWeekStartStr = formatDate(previousWeekStart);
    const previousWeekEndStr = formatDate(previousWeekEnd);

    // Query current week downtime events
    let currentWeekQuery = supabase
      .from("downtime_events")
      .select("press, category, minutes")
      .gte("date", currentWeekStartStr)
      .lte("date", currentWeekEndStr);

    if (filters.press) {
      currentWeekQuery = currentWeekQuery.eq("press", filters.press);
    }

    const { data: currentWeekData, error: currentWeekError } = await currentWeekQuery;

    if (currentWeekError) {
      console.error("Error fetching current week downtime events:", currentWeekError);
      return [];
    }

    // Query previous week downtime events
    let previousWeekQuery = supabase
      .from("downtime_events")
      .select("press, category, minutes")
      .gte("date", previousWeekStartStr)
      .lte("date", previousWeekEndStr);

    if (filters.press) {
      previousWeekQuery = previousWeekQuery.eq("press", filters.press);
    }

    const { data: previousWeekData, error: previousWeekError } = await previousWeekQuery;

    if (previousWeekError) {
      console.error("Error fetching previous week downtime events:", previousWeekError);
      return [];
    }

    // Aggregate current week data by press and category
    const currentWeekMap = new Map<string, number>(); // key: "press_category", value: total minutes
    if (currentWeekData) {
      currentWeekData.forEach((event) => {
        const key = `${event.press}_${event.category}`;
        const currentMinutes = currentWeekMap.get(key) || 0;
        currentWeekMap.set(key, currentMinutes + (event.minutes || 0));
      });
    }

    // Aggregate previous week data by press and category
    const previousWeekMap = new Map<string, number>(); // key: "press_category", value: total minutes
    if (previousWeekData) {
      previousWeekData.forEach((event) => {
        const key = `${event.press}_${event.category}`;
        const currentMinutes = previousWeekMap.get(key) || 0;
        previousWeekMap.set(key, currentMinutes + (event.minutes || 0));
      });
    }

    // Create alerts with trend calculation
    const alerts: MaintenanceAlert[] = [];
    const allKeys = new Set([...Array.from(currentWeekMap.keys()), ...Array.from(previousWeekMap.keys())]);

    allKeys.forEach((key) => {
      const [press, category] = key.split("_");
      const currentMinutes = currentWeekMap.get(key) || 0;
      const previousMinutes = previousWeekMap.get(key) || 0;

      // Calculate trend percentage
      let trendPct = 0;
      if (previousMinutes > 0) {
        trendPct = ((currentMinutes - previousMinutes) / previousMinutes) * 100;
      } else if (currentMinutes > 0) {
        trendPct = 100; // New issue, 100% increase
      }

      // Determine severity
      // Urgent: >120 minutes current week OR >50% increase with >60 minutes
      // Warning: >60 minutes current week OR >30% increase with >30 minutes
      // Monitor: everything else
      let severity: "urgent" | "warning" | "monitor" = "monitor";
      if (currentMinutes > 120 || (trendPct > 50 && currentMinutes > 60)) {
        severity = "urgent";
      } else if (currentMinutes > 60 || (trendPct > 30 && currentMinutes > 30)) {
        severity = "warning";
      }

      // Get recommendation
      const recommendation = getTrainingRecommendation(category);

      alerts.push({
        press: press || "",
        category: category || "",
        current_week_minutes: currentMinutes,
        trend_pct: trendPct,
        severity,
        recommendation,
      });
    });

    // Sort by severity (urgent first) then by current_week_minutes descending
    const severityOrder = { urgent: 0, warning: 1, monitor: 2 };
    alerts.sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return b.current_week_minutes - a.current_week_minutes;
    });

    return alerts;
  } catch (error) {
    console.error("Exception fetching maintenance alerts:", error);
    return [];
  }
}

export interface WeeklyDowntimeData {
  week_start_date: string; // YYYY-MM-DD format
  total_minutes: number;
}

/**
 * Gets weekly downtime data for a specific press and category
 * Groups downtime events by week for trend analysis
 * 
 * @param press - Press code (e.g., "LP05")
 * @param category - Downtime category (e.g., "Changing Bulks")
 * @param weeksLookback - Number of weeks to look back (default: 12)
 * @returns Array of WeeklyDowntimeData objects, sorted by week_start_date ascending
 * 
 * @example
 * const weeklyData = await getWeeklyDowntimeData("LP05", "Changing Bulks", 12);
 * weeklyData.forEach(week => {
 *   console.log(`${week.week_start_date}: ${week.total_minutes} minutes`);
 * });
 */
export async function getWeeklyDowntimeData(
  press: string,
  category: string,
  weeksLookback: number = 12
): Promise<WeeklyDowntimeData[]> {
  try {
    // Calculate date range
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - (weeksLookback * 7));
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(today);
    endDate.setHours(23, 59, 59, 999);

    // Format dates for PostgreSQL
    const formatDate = (date: Date) => date.toISOString().split("T")[0];
    const startDateStr = formatDate(startDate);
    const endDateStr = formatDate(endDate);

    // Query downtime events
    const { data, error } = await supabase
      .from("downtime_events")
      .select("date, minutes")
      .eq("press", press)
      .eq("category", category)
      .gte("date", startDateStr)
      .lte("date", endDateStr)
      .order("date", { ascending: true });

    if (error) {
      console.error("Error fetching weekly downtime data:", error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Group by week (week starts on Sunday)
    const weekMap = new Map<string, number>(); // key: week_start_date (YYYY-MM-DD), value: total minutes

    data.forEach((event) => {
      if (!event.date) return;

      const eventDate = new Date(event.date);
      // Calculate week start (Sunday)
      const dayOfWeek = eventDate.getDay();
      const weekStart = new Date(eventDate);
      weekStart.setDate(eventDate.getDate() - dayOfWeek);
      weekStart.setHours(0, 0, 0, 0);

      const weekStartStr = formatDate(weekStart);
      const currentMinutes = weekMap.get(weekStartStr) || 0;
      weekMap.set(weekStartStr, currentMinutes + (event.minutes || 0));
    });

    // Convert to array and sort by week_start_date
    const weeklyData: WeeklyDowntimeData[] = Array.from(weekMap.entries())
      .map(([week_start_date, total_minutes]) => ({
        week_start_date,
        total_minutes,
      }))
      .sort((a, b) => a.week_start_date.localeCompare(b.week_start_date));

    return weeklyData;
  } catch (error) {
    console.error("Exception fetching weekly downtime data:", error);
    return [];
  }
}

export interface ProductionRunReport {
  id: string;
  date: string; // DD-MM-YYYY format
  press: string;
  shift: string;
  team: string;
  work_order: string | null;
  good_production: number;
  calculated_run_speed: number;
  spoilage_percentage: number;
  make_ready_minutes: number;
}

/**
 * Gets production run reports with optional filters
 * Queries production_runs table with search and filter capabilities
 * 
 * @param filters - Filter options for the query
 * @returns Array of ProductionRunReport objects, ordered by date DESC, then press ASC
 * 
 * @example
 * const reports = await getProductionRunReports({
 *   workOrder: "62784752",
 *   startDate: "2025-11-01",
 *   endDate: "2025-11-30",
 *   press: "LP05"
 * });
 */
export async function getProductionRunReports(filters: {
  workOrder?: string;
  startDate?: string; // YYYY-MM-DD format
  endDate?: string; // YYYY-MM-DD format
  press?: string;
  shift?: string;
  team?: string;
}): Promise<ProductionRunReport[]> {
  try {
    let query = supabase
      .from("production_runs")
      .select("id, date, press, shift, team, work_order, good_production, calculated_run_speed, spoilage_percentage, make_ready_minutes")
      .order("date", { ascending: false })
      .order("press", { ascending: true });

    // Apply work order filter
    if (filters.workOrder) {
      query = query.eq("work_order", filters.workOrder);
    }

    // Apply date range filters
    if (filters.startDate) {
      query = query.gte("date", filters.startDate);
    }

    if (filters.endDate) {
      query = query.lte("date", filters.endDate);
    }

    // Apply press filter
    if (filters.press) {
      query = query.eq("press", filters.press);
    }

    // Apply shift filter
    if (filters.shift) {
      query = query.eq("shift", filters.shift);
    }

    // Apply team filter
    if (filters.team) {
      query = query.eq("team", filters.team);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching production run reports:", error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Convert date from YYYY-MM-DD to DD-MM-YYYY format and map to return type
    return data.map((record) => {
      // Convert date from YYYY-MM-DD back to DD-MM-YYYY
      const recordDate = new Date(record.date);
      const day = String(recordDate.getDate()).padStart(2, "0");
      const month = String(recordDate.getMonth() + 1).padStart(2, "0");
      const year = recordDate.getFullYear();
      const formattedDate = `${day}-${month}-${year}`;

      return {
        id: record.id,
        date: formattedDate,
        press: record.press || "",
        shift: record.shift || "",
        team: record.team || "",
        work_order: record.work_order,
        good_production: record.good_production || 0,
        calculated_run_speed: typeof record.calculated_run_speed === "number" 
          ? record.calculated_run_speed 
          : parseFloat(record.calculated_run_speed as string) || 0,
        spoilage_percentage: typeof record.spoilage_percentage === "number"
          ? record.spoilage_percentage
          : parseFloat(record.spoilage_percentage as string) || 0,
        make_ready_minutes: record.make_ready_minutes || 0,
      };
    });
  } catch (error) {
    console.error("Exception fetching production run reports:", error);
    return [];
  }
}

export interface WorkOrderSearchResult {
  id: string;
  date: string; // DD-MM-YYYY format
  press: string;
  shift: string;
  team: string;
  work_order: string | null;
  good_production: number;
  calculated_run_speed: number;
  spoilage_percentage: number;
  make_ready_minutes: number;
  production_minutes: number;
  logged_downtime_minutes: number;
  total_downtime_minutes: number; // Aggregated from downtime_events
  total_spoilage_units: number; // Aggregated from spoilage_events
  downtime_events: Array<{ category: string; minutes: number }>;
  spoilage_events: Array<{ category: string; units: number }>;
}

/**
 * Searches for production runs by work order number
 * Joins with downtime_events and spoilage_events to provide complete information
 * 
 * @param workOrder - Work order number to search for
 * @param startDate - Optional start date filter (YYYY-MM-DD format)
 * @param endDate - Optional end date filter (YYYY-MM-DD format)
 * @returns Array of WorkOrderSearchResult objects with aggregated downtime and spoilage, ordered by date and shift
 * 
 * @example
 * const results = await searchWorkOrder("62784752", "2025-11-01", "2025-11-30");
 * results.forEach(run => {
 *   console.log(`Run on ${run.date}: ${run.total_downtime_minutes} min downtime, ${run.total_spoilage_units} units spoilage`);
 * });
 */
export async function searchWorkOrder(
  workOrder: string,
  startDate?: string,
  endDate?: string
): Promise<WorkOrderSearchResult[]> {
  try {
    // Query production_runs table
    let query = supabase
      .from("production_runs")
      .select("id, date, press, shift, team, work_order, good_production, calculated_run_speed, spoilage_percentage, make_ready_minutes, production_minutes, logged_downtime_minutes")
      .eq("work_order", workOrder)
      .order("date", { ascending: true })
      .order("shift", { ascending: true });

    // Apply date range filters if provided
    if (startDate) {
      query = query.gte("date", startDate);
    }

    if (endDate) {
      query = query.lte("date", endDate);
    }

    const { data: productionRuns, error: runsError } = await query;

    if (runsError) {
      console.error("Error fetching production runs:", runsError);
      return [];
    }

    if (!productionRuns || productionRuns.length === 0) {
      return [];
    }

    // Get all production run IDs
    const runIds = productionRuns.map((run) => run.id);

    // Query downtime_events for all runs
    const { data: downtimeEvents, error: downtimeError } = await supabase
      .from("downtime_events")
      .select("production_run_id, category, minutes")
      .in("production_run_id", runIds);

    if (downtimeError) {
      console.error("Error fetching downtime events:", downtimeError);
      // Continue without downtime data rather than failing completely
    }

    // Query spoilage_events for all runs
    const { data: spoilageEvents, error: spoilageError } = await supabase
      .from("spoilage_events")
      .select("production_run_id, category, units")
      .in("production_run_id", runIds);

    if (spoilageError) {
      console.error("Error fetching spoilage events:", spoilageError);
      // Continue without spoilage data rather than failing completely
    }

    // Group downtime and spoilage events by production_run_id
    const downtimeByRunId = new Map<string, Array<{ category: string; minutes: number }>>();
    const spoilageByRunId = new Map<string, Array<{ category: string; units: number }>>();

    if (downtimeEvents) {
      downtimeEvents.forEach((event) => {
        const runId = event.production_run_id;
        if (!downtimeByRunId.has(runId)) {
          downtimeByRunId.set(runId, []);
        }
        downtimeByRunId.get(runId)!.push({
          category: event.category || "Unknown",
          minutes: event.minutes || 0,
        });
      });
    }

    if (spoilageEvents) {
      spoilageEvents.forEach((event) => {
        const runId = event.production_run_id;
        if (!spoilageByRunId.has(runId)) {
          spoilageByRunId.set(runId, []);
        }
        spoilageByRunId.get(runId)!.push({
          category: event.category || "Unknown",
          units: event.units || 0,
        });
      });
    }

    // Combine production runs with aggregated downtime and spoilage
    return productionRuns.map((run) => {
      const runId = run.id;
      const downtimeEventsForRun = downtimeByRunId.get(runId) || [];
      const spoilageEventsForRun = spoilageByRunId.get(runId) || [];

      // Calculate totals
      const totalDowntimeMinutes = downtimeEventsForRun.reduce(
        (sum, event) => sum + event.minutes,
        0
      );
      const totalSpoilageUnits = spoilageEventsForRun.reduce(
        (sum, event) => sum + event.units,
        0
      );

      // Convert date from YYYY-MM-DD to DD-MM-YYYY format
      const recordDate = new Date(run.date);
      const day = String(recordDate.getDate()).padStart(2, "0");
      const month = String(recordDate.getMonth() + 1).padStart(2, "0");
      const year = recordDate.getFullYear();
      const formattedDate = `${day}-${month}-${year}`;

      return {
        id: run.id,
        date: formattedDate,
        press: run.press || "",
        shift: run.shift || "",
        team: run.team || "",
        work_order: run.work_order,
        good_production: run.good_production || 0,
        calculated_run_speed: typeof run.calculated_run_speed === "number"
          ? run.calculated_run_speed
          : parseFloat(run.calculated_run_speed as string) || 0,
        spoilage_percentage: typeof run.spoilage_percentage === "number"
          ? run.spoilage_percentage
          : parseFloat(run.spoilage_percentage as string) || 0,
        make_ready_minutes: run.make_ready_minutes || 0,
        production_minutes: run.production_minutes || 0,
        logged_downtime_minutes: run.logged_downtime_minutes || 0,
        total_downtime_minutes: totalDowntimeMinutes,
        total_spoilage_units: totalSpoilageUnits,
        downtime_events: downtimeEventsForRun,
        spoilage_events: spoilageEventsForRun,
      };
    });
  } catch (error) {
    console.error("Exception searching work order:", error);
    return [];
  }
}

/**
 * Press Targets Interface
 */
export interface PressTarget {
  press: string;
  target_run_speed: number;
  target_efficiency_pct: number;
  target_spoilage_pct: number;
}

/**
 * Get all press targets from the database
 * @returns Array of press targets
 */
export async function getPressTargets(): Promise<PressTarget[]> {
  try {
    const { data, error } = await supabase
      .from("press_targets")
      .select("*")
      .order("press", { ascending: true });

    if (error) {
      console.error("Error fetching press targets:", error);
      throw error;
    }

    return (data || []).map((target) => ({
      press: target.press,
      target_run_speed: target.target_run_speed || 0,
      target_efficiency_pct: target.target_efficiency_pct || 0,
      target_spoilage_pct: target.target_spoilage_pct || 0,
    }));
  } catch (error) {
    console.error("Exception fetching press targets:", error);
    throw error;
  }
}

/**
 * Save press targets to the database
 * Uses upsert to insert or update existing targets
 * @param targets Array of press targets to save
 */
export async function savePressTargets(targets: PressTarget[]): Promise<void> {
  try {
    // Prepare data for upsert
    const upsertData = targets.map((target) => ({
      press: target.press,
      target_run_speed: target.target_run_speed,
      target_efficiency_pct: target.target_efficiency_pct,
      target_spoilage_pct: target.target_spoilage_pct,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("press_targets")
      .upsert(upsertData, {
        onConflict: "press",
        ignoreDuplicates: false,
      });

    if (error) {
      console.error("Error saving press targets:", error);
      throw error;
    }
  } catch (error) {
    console.error("Exception saving press targets:", error);
    throw error;
  }
}

/**
 * Update targets for a specific press
 * @param press Press code (e.g., 'LA01', 'LP03')
 * @param targets Partial target object with fields to update
 * @returns Updated press target or null if not found
 */
export async function updatePressTarget(
  press: string,
  targets: Partial<Omit<PressTarget, "press">>
): Promise<PressTarget | null> {
  try {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (targets.target_run_speed !== undefined) {
      updateData.target_run_speed = targets.target_run_speed;
    }
    if (targets.target_efficiency_pct !== undefined) {
      updateData.target_efficiency_pct = targets.target_efficiency_pct;
    }
    if (targets.target_spoilage_pct !== undefined) {
      updateData.target_spoilage_pct = targets.target_spoilage_pct;
    }

    const { data, error } = await supabase
      .from("press_targets")
      .update(updateData)
      .eq("press", press)
      .select()
      .single();

    if (error) {
      console.error("Error updating press target:", error);
      throw error;
    }

    if (!data) {
      return null;
    }

    return {
      press: data.press,
      target_run_speed: data.target_run_speed || 0,
      target_efficiency_pct: data.target_efficiency_pct || 0,
      target_spoilage_pct: data.target_spoilage_pct || 0,
    };
  } catch (error) {
    console.error("Exception updating press target:", error);
    throw error;
  }
}

/**
 * Target Comparison Interface
 * Compares actual performance against targets
 */
export interface TargetComparison {
  press: string;
  date: string;
  // Actual values from daily_production_summary
  actual_run_speed: number;
  actual_efficiency_pct: number;
  actual_spoilage_pct: number;
  // Target values from press_targets
  target_run_speed: number;
  target_efficiency_pct: number;
  target_spoilage_pct: number;
  // Variance calculations
  run_speed_variance: number; // actual - target
  run_speed_variance_pct: number; // ((actual - target) / target) * 100
  efficiency_variance: number; // actual - target
  efficiency_variance_pct: number; // ((actual - target) / target) * 100
  spoilage_variance: number; // actual - target
  spoilage_variance_pct: number; // ((actual - target) / target) * 100
}

/**
 * Get target comparison for a specific press and date
 * Joins daily_production_summary with press_targets to calculate variance
 * @param press Press code (e.g., 'LA01', 'LP03')
 * @param date Date in DD-MM-YYYY format
 * @returns Target comparison data or null if no data found
 */
export async function getTargetComparison(
  press: string,
  date: string
): Promise<TargetComparison | null> {
  try {
    // First, get the daily production data
    const productionData = await getDailyProduction(date);
    const dailyData = productionData.find((row) => row.press === press);

    if (!dailyData) {
      return null; // No production data for this press/date
    }

    // Get the press target
    const targets = await getPressTargets();
    const target = targets.find((t) => t.press === press);

    if (!target) {
      return null; // No target data for this press
    }

    // Calculate actual values
    const actualRunSpeed = dailyData.avg_run_speed || 0;
    const actualEfficiency = dailyData.efficiency_pct || 0;
    const actualSpoilage = dailyData.avg_spoilage_pct || 0;

    // Calculate variances
    const runSpeedVariance = actualRunSpeed - target.target_run_speed;
    const runSpeedVariancePct =
      target.target_run_speed > 0
        ? (runSpeedVariance / target.target_run_speed) * 100
        : 0;

    const efficiencyVariance = actualEfficiency - target.target_efficiency_pct;
    const efficiencyVariancePct =
      target.target_efficiency_pct > 0
        ? (efficiencyVariance / target.target_efficiency_pct) * 100
        : 0;

    const spoilageVariance = actualSpoilage - target.target_spoilage_pct;
    const spoilageVariancePct =
      target.target_spoilage_pct > 0
        ? (spoilageVariance / target.target_spoilage_pct) * 100
        : 0;

    return {
      press,
      date,
      actual_run_speed: actualRunSpeed,
      actual_efficiency_pct: actualEfficiency,
      actual_spoilage_pct: actualSpoilage,
      target_run_speed: target.target_run_speed,
      target_efficiency_pct: target.target_efficiency_pct,
      target_spoilage_pct: target.target_spoilage_pct,
      run_speed_variance: runSpeedVariance,
      run_speed_variance_pct: runSpeedVariancePct,
      efficiency_variance: efficiencyVariance,
      efficiency_variance_pct: efficiencyVariancePct,
      spoilage_variance: spoilageVariance,
      spoilage_variance_pct: spoilageVariancePct,
    };
  } catch (error) {
    console.error("Exception getting target comparison:", error);
    throw error;
  }
}

/**
 * Production Comparison Interface
 * Contains aggregated data for a press across two periods
 */
export interface ProductionComparison {
  press: string;
  // Period A data
  periodA_production: number;
  periodA_avg_speed: number;
  periodA_avg_spoilage: number;
  periodA_total_downtime: number;
  periodA_run_count: number;
  // Period B data
  periodB_production: number;
  periodB_avg_speed: number;
  periodB_avg_spoilage: number;
  periodB_total_downtime: number;
  periodB_run_count: number;
  // Differences
  production_change: number;
  production_change_pct: number;
  speed_change: number;
  speed_change_pct: number;
  spoilage_change: number;
  spoilage_change_pct: number;
  downtime_change: number;
  downtime_change_pct: number;
}

/**
 * Get production comparison between two periods
 * Aggregates production_runs data by press for both periods and calculates differences
 * @param startDateA Start date for Period A (YYYY-MM-DD)
 * @param endDateA End date for Period A (YYYY-MM-DD)
 * @param startDateB Start date for Period B (YYYY-MM-DD)
 * @param endDateB End date for Period B (YYYY-MM-DD)
 * @returns Array of production comparisons by press
 */
export async function getProductionComparison(
  startDateA: string,
  endDateA: string,
  startDateB: string,
  endDateB: string
): Promise<ProductionComparison[]> {
  try {
    // Fetch production runs for Period A
    const { data: dataA, error: errorA } = await supabase
      .from("production_runs")
      .select("press, good_production, calculated_run_speed, spoilage_percentage, logged_downtime_minutes, date")
      .gte("date", startDateA)
      .lte("date", endDateA);

    if (errorA) {
      console.error("Error fetching Period A data:", errorA);
      throw errorA;
    }

    // Fetch production runs for Period B
    const { data: dataB, error: errorB } = await supabase
      .from("production_runs")
      .select("press, good_production, calculated_run_speed, spoilage_percentage, logged_downtime_minutes, date")
      .gte("date", startDateB)
      .lte("date", endDateB);

    if (errorB) {
      console.error("Error fetching Period B data:", errorB);
      throw errorB;
    }

    // Aggregate Period A data by press
    const periodAMap = new Map<
      string,
      {
        production: number;
        speed: number;
        spoilage: number;
        downtime: number;
        count: number;
      }
    >();

    if (dataA) {
      dataA.forEach((run) => {
        const press = run.press || "";
        if (!press) return;

        const existing = periodAMap.get(press) || {
          production: 0,
          speed: 0,
          spoilage: 0,
          downtime: 0,
          count: 0,
        };

        periodAMap.set(press, {
          production: existing.production + (run.good_production || 0),
          speed: existing.speed + (run.calculated_run_speed || 0),
          spoilage: existing.spoilage + (run.spoilage_percentage || 0),
          downtime: existing.downtime + (run.logged_downtime_minutes || 0),
          count: existing.count + 1,
        });
      });
    }

    // Aggregate Period B data by press
    const periodBMap = new Map<
      string,
      {
        production: number;
        speed: number;
        spoilage: number;
        downtime: number;
        count: number;
      }
    >();

    if (dataB) {
      dataB.forEach((run) => {
        const press = run.press || "";
        if (!press) return;

        const existing = periodBMap.get(press) || {
          production: 0,
          speed: 0,
          spoilage: 0,
          downtime: 0,
          count: 0,
        };

        periodBMap.set(press, {
          production: existing.production + (run.good_production || 0),
          speed: existing.speed + (run.calculated_run_speed || 0),
          spoilage: existing.spoilage + (run.spoilage_percentage || 0),
          downtime: existing.downtime + (run.logged_downtime_minutes || 0),
          count: existing.count + 1,
        });
      });
    }

    // Get all unique presses from both periods
    const allPresses = new Set<string>();
    periodAMap.forEach((_, press) => allPresses.add(press));
    periodBMap.forEach((_, press) => allPresses.add(press));

    // Calculate comparisons for each press
    const comparisons: ProductionComparison[] = Array.from(allPresses).map((press) => {
      const dataA = periodAMap.get(press) || {
        production: 0,
        speed: 0,
        spoilage: 0,
        downtime: 0,
        count: 0,
      };
      const dataB = periodBMap.get(press) || {
        production: 0,
        speed: 0,
        spoilage: 0,
        downtime: 0,
        count: 0,
      };

      // Calculate averages
      const avgSpeedA = dataA.count > 0 ? dataA.speed / dataA.count : 0;
      const avgSpeedB = dataB.count > 0 ? dataB.speed / dataB.count : 0;
      const avgSpoilageA = dataA.count > 0 ? dataA.spoilage / dataA.count : 0;
      const avgSpoilageB = dataB.count > 0 ? dataB.spoilage / dataB.count : 0;

      // Calculate changes
      const productionChange = dataA.production - dataB.production;
      const productionChangePct = dataB.production > 0 ? (productionChange / dataB.production) * 100 : 0;

      const speedChange = avgSpeedA - avgSpeedB;
      const speedChangePct = avgSpeedB > 0 ? (speedChange / avgSpeedB) * 100 : 0;

      const spoilageChange = avgSpoilageA - avgSpoilageB;
      const spoilageChangePct = avgSpoilageB > 0 ? (spoilageChange / avgSpoilageB) * 100 : 0;

      const downtimeChange = dataA.downtime - dataB.downtime;
      const downtimeChangePct = dataB.downtime > 0 ? (downtimeChange / dataB.downtime) * 100 : 0;

      return {
        press,
        periodA_production: dataA.production,
        periodA_avg_speed: avgSpeedA,
        periodA_avg_spoilage: avgSpoilageA,
        periodA_total_downtime: dataA.downtime,
        periodA_run_count: dataA.count,
        periodB_production: dataB.production,
        periodB_avg_speed: avgSpeedB,
        periodB_avg_spoilage: avgSpoilageB,
        periodB_total_downtime: dataB.downtime,
        periodB_run_count: dataB.count,
        production_change: productionChange,
        production_change_pct: productionChangePct,
        speed_change: speedChange,
        speed_change_pct: speedChangePct,
        spoilage_change: spoilageChange,
        spoilage_change_pct: spoilageChangePct,
        downtime_change: downtimeChange,
        downtime_change_pct: downtimeChangePct,
      };
    });

    // Sort by press code
    return comparisons.sort((a, b) => a.press.localeCompare(b.press));
  } catch (error) {
    console.error("Exception getting production comparison:", error);
    throw error;
  }
}

/**
 * Recurring Issue Interface
 * Represents a recurring issue category with aggregated statistics
 */
export interface RecurringIssue {
  category: string;
  occurrences: number;
  totalImpact: number;
  affectedPresses: string[];
  mostAffectedTeam: string | null;
  trend: "increasing" | "stable" | "decreasing";
  firstHalfCount: number;
  secondHalfCount: number;
}

/**
 * Get recurring issues for downtime or spoilage
 * Groups events by category, calculates statistics, and determines trends
 * 
 * @param days - Number of days to look back (default: 30)
 * @param press - Optional press filter (if not provided, includes all presses)
 * @param issueType - Type of issue: 'downtime' or 'spoilage'
 * @returns Array of recurring issues sorted by occurrence count (descending)
 * 
 * @example
 * const downtimeIssues = await getRecurringIssues(30, "LP05", "downtime");
 * const spoilageIssues = await getRecurringIssues(60, undefined, "spoilage");
 */
export async function getRecurringIssues(
  days: number = 30,
  press?: string,
  issueType: "downtime" | "spoilage" = "downtime"
): Promise<RecurringIssue[]> {
  try {
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    const endDateStr = endDate.toISOString().split("T")[0];
    const startDateStr = startDate.toISOString().split("T")[0];

    // Calculate midpoint for trend analysis (first half vs second half)
    const midpointDate = new Date(startDate);
    midpointDate.setDate(startDate.getDate() + Math.floor(days / 2));
    const midpointDateStr = midpointDate.toISOString().split("T")[0];

    // Fetch ignored categories
    let ignoredQuery = supabase
      .from("ignored_issue_categories")
      .select("category, press")
      .eq("issue_type", issueType);

    if (press) {
      ignoredQuery = ignoredQuery.or(`press.is.null,press.eq.${press}`);
    } else {
      ignoredQuery = ignoredQuery.is("press", null);
    }

    const { data: ignoredCategories } = await ignoredQuery;

    // Create set of ignored categories
    const ignoredSet = new Set<string>();
    if (ignoredCategories) {
      ignoredCategories.forEach((item) => {
        if (!item.press || item.press === press || !press) {
          ignoredSet.add(item.category);
        }
      });
    }

    // Determine which table to query
    const tableName = issueType === "downtime" ? "downtime_events" : "spoilage_events";
    const impactField = issueType === "downtime" ? "minutes" : "units";

    // Build query
    let query = supabase
      .from(tableName)
      .select(`category, press, team, date, ${impactField}`)
      .gte("date", startDateStr)
      .lte("date", endDateStr);

    if (press) {
      query = query.eq("press", press);
    }

    const { data: events, error } = await query;

    if (error) {
      console.error(`Error fetching ${issueType} events:`, error);
      throw error;
    }

    if (!events || events.length === 0) {
      return [];
    }

    // Group events by category
    const categoryMap = new Map<
      string,
      {
        occurrences: number;
        totalImpact: number;
        presses: Set<string>;
        teams: Map<string, number>;
        firstHalfCount: number;
        secondHalfCount: number;
      }
    >();

    events.forEach((event) => {
      const category = event.category || "Unknown";

      // Skip ignored categories
      if (ignoredSet.has(category)) {
        return;
      }

      const existing = categoryMap.get(category) || {
        occurrences: 0,
        totalImpact: 0,
        presses: new Set<string>(),
        teams: new Map<string, number>(),
        firstHalfCount: 0,
        secondHalfCount: 0,
      };

      const impact = issueType === "downtime"
        ? ((event as { minutes?: number }).minutes || 0)
        : ((event as { units?: number }).units || 0);
      const eventDate = event.date || "";

      // Determine which half of the period this event belongs to
      if (eventDate < midpointDateStr) {
        existing.firstHalfCount++;
      } else {
        existing.secondHalfCount++;
      }

      categoryMap.set(category, {
        occurrences: existing.occurrences + 1,
        totalImpact: existing.totalImpact + impact,
        presses: existing.presses.add(event.press || ""),
        teams: (() => {
          const team = event.team || "";
          if (team) {
            const count = existing.teams.get(team) || 0;
            existing.teams.set(team, count + 1);
          }
          return existing.teams;
        })(),
        firstHalfCount: existing.firstHalfCount,
        secondHalfCount: existing.secondHalfCount,
      });
    });

    // Convert to array and filter (3+ occurrences) and calculate trends
    const recurringIssues: RecurringIssue[] = Array.from(categoryMap.entries())
      .filter(([, data]) => data.occurrences >= 3) // Filter to 3+ occurrences
      .map(([category, data]) => {
        // Calculate trend based on first half vs second half
        let trend: "increasing" | "stable" | "decreasing";

        if (data.firstHalfCount === 0) {
          // If no occurrences in first half, any in second half is increasing
          trend = data.secondHalfCount > 0 ? "increasing" : "stable";
        } else {
          const change = ((data.secondHalfCount - data.firstHalfCount) / data.firstHalfCount) * 100;
          if (change > 20) {
            trend = "increasing";
          } else if (change < -20) {
            trend = "decreasing";
          } else {
            trend = "stable";
          }
        }

        // Find most affected team
        let mostAffectedTeam: string | null = null;
        let maxTeamCount = 0;
        data.teams.forEach((count, team) => {
          if (count > maxTeamCount) {
            maxTeamCount = count;
            mostAffectedTeam = team;
          }
        });

        return {
          category,
          occurrences: data.occurrences,
          totalImpact: data.totalImpact,
          affectedPresses: Array.from(data.presses).filter((p) => p),
          mostAffectedTeam,
          trend,
          firstHalfCount: data.firstHalfCount,
          secondHalfCount: data.secondHalfCount,
        };
      })
      .sort((a, b) => b.occurrences - a.occurrences); // Sort by occurrence count DESC

    return recurringIssues;
  } catch (error) {
    console.error(`Exception getting recurring ${issueType} issues:`, error);
    throw error;
  }
}

