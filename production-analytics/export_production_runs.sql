-- SQL query to export production_runs table for analysis
-- Run this in your Supabase SQL editor or database client

SELECT 
    id,
    press,
    date,
    work_order,
    good_production,
    lhe_units,
    spoilage_percentage,
    shift_start_time,
    shift_end_time,
    make_ready_start_time,
    make_ready_end_time,
    make_ready_minutes,
    production_start_time,
    production_end_time,
    production_minutes,
    logged_downtime_minutes,
    shift,
    team,
    team_identifier,
    calculated_run_speed,
    comments,
    created_at
FROM production_runs
ORDER BY date DESC, press, shift, team, work_order;

-- Alternative: Export to CSV format (if your database supports it)
-- COPY (
--     SELECT * FROM production_runs ORDER BY date DESC, press, shift, team, work_order
-- ) TO '/tmp/production_runs_export.csv' WITH CSV HEADER;

