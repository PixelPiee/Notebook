-- Migration: Create salary tables for Rojalin Payroll Tracker
-- Description: Sets up employees, hours, and advances tables

CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hourly_rate REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS hours (
    employee_id TEXT NOT NULL,
    date TEXT NOT NULL,
    hours REAL NOT NULL,
    PRIMARY KEY (employee_id, date),
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS advances (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL,
    date TEXT NOT NULL,
    amount REAL NOT NULL,
    notes TEXT,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

-- Index to optimize querying advances by employee
CREATE INDEX IF NOT EXISTS idx_advances_employee ON advances(employee_id);
