-- Migration: Add WO Number and Contractor Name to employees table
ALTER TABLE employees ADD COLUMN wo_number TEXT;
ALTER TABLE employees ADD COLUMN contractor_name TEXT;
