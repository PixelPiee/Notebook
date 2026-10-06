-- Migration: Add Shift Duration column to employees table
-- This adds a numeric column for shift duration in hours (e.g. 8, 10) with default 8
ALTER TABLE employees ADD COLUMN shift_duration REAL DEFAULT 8;
