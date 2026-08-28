-- Migration: Add Incentive Rate column to employees table
-- This adds a numeric column with a default of 0 for existing rows
ALTER TABLE employees ADD COLUMN incentive_rate REAL DEFAULT 0;
