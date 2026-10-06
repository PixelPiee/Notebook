// ==========================================================================
// SalaryTrack Pro - Core JavaScript Controller
// ==========================================================================

// Global Application State
let employees = [];
let selectedYear = 2026;
let selectedMonthIndex = 7; // August (0-indexed)
let searchQuery = "";
let selectedContractorFilter = "ALL";
let currentEmployeeForAdvances = null;
let editingEmployeeId = null;

// Backend API configuration
const API_BASE_URL =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
        ? "http://localhost:8787"
        : "https://notebook.dev-bhuyan256.workers.dev";
let saveTimer = null;
let isLoadingFromServer = false;
let syncQueue = [];
let isSyncing = false;

// Mock Data for New Users (Visual Showcase)
const defaultEmployees = [
    {
        id: "emp-1",
        name: "Dev Bhuyan",
        woNumber: "WO-001",
        contractorName: "Rojalin Services",
        hourlyRate: 200,
        incentiveRate: 0,
        shiftDuration: 10,
        hours: {
            "2026-08-01": 8,
            "2026-08-02": 8,
            "2026-08-03": 8,
            "2026-08-04": 8,
            "2026-08-05": 8,
            "2026-08-06": 0,
            "2026-08-07": 0,
            "2026-08-08": 8,
            "2026-08-09": 8,
            "2026-08-10": 10,
            "2026-08-11": 10,
            "2026-08-12": 8,
            "2026-08-15": 8,
            "2026-08-16": 8,
            "2026-08-17": 8,
            "2026-08-18": 8
        },
        advances: [
            { id: "adv-1-1", date: "2026-08-02", amount: 500, notes: "Advance on 2nd of the month" },
            { id: "adv-1-2", date: "2026-08-12", amount: 1500, notes: "Mid-month medical loan" }
        ]
    },
    {
        id: "emp-2",
        name: "Priya Sharma",
        woNumber: "WO-002",
        contractorName: "Rojalin Services",
        hourlyRate: 150,
        incentiveRate: 0,
        shiftDuration: 8,
        hours: {
            "2026-08-01": 8,
            "2026-08-02": 8,
            "2026-08-03": 4,
            "2026-08-04": 8,
            "2026-08-05": 8,
            "2026-08-08": 8,
            "2026-08-09": 8,
            "2026-08-10": 8,
            "2026-08-11": 8,
            "2026-08-12": 8,
            "2026-08-15": 8,
            "2026-08-16": 8,
            "2026-08-17": 8
        },
        advances: [
            { id: "adv-2-1", date: "2026-08-08", amount: 300, notes: "Festival advance" }
        ]
    },
    {
        id: "emp-3",
        name: "Rahul Verma",
        woNumber: "WO-003",
        contractorName: "Alpha Tech",
        hourlyRate: 120,
        incentiveRate: 0,
        shiftDuration: 10,
        hours: {
            "2026-08-01": 9,
            "2026-08-02": 9,
            "2026-08-03": 9,
            "2026-08-04": 9,
            "2026-08-05": 9,
            "2026-08-08": 9,
            "2026-08-09": 9,
            "2026-08-10": 9,
            "2026-08-11": 9,
            "2026-08-12": 9,
            "2026-08-15": 6,
            "2026-08-16": 6
        },
        advances: []
    }
];

// Auth state
let authToken = localStorage.getItem("salarytrack_token") || null;
let currentUser = null;

function getAuthHeaders() {
    const headers = { "Accept": "application/json" };
    if (authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
    }
    return headers;
}

// ==========================================================================
// Authentication & Access Control
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

async function initApp() {
    registerAuthListeners();
    const isAuthenticated = await checkAuthStatus();
    if (isAuthenticated) {
        await loadAppData();
    }
}

function registerAuthListeners() {
    const loginForm = document.getElementById("loginForm");
    if (loginForm) {
        loginForm.addEventListener("submit", handleLoginSubmit);
    }

    const logoutBtn = document.getElementById("btnLogout");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", handleLogout);
    }

    const togglePasswordBtn = document.getElementById("btnTogglePassword");
    const passwordInput = document.getElementById("loginPassword");
    const eyeIcon = document.getElementById("eyeIcon");
    if (togglePasswordBtn && passwordInput && eyeIcon) {
        togglePasswordBtn.addEventListener("click", () => {
            if (passwordInput.type === "password") {
                passwordInput.type = "text";
                eyeIcon.className = "fa-solid fa-eye-slash";
            } else {
                passwordInput.type = "password";
                eyeIcon.className = "fa-solid fa-eye";
            }
        });
    }
}

function showLoginScreen(errorMsg = "") {
    document.getElementById("loginOverlay").style.display = "flex";
    document.getElementById("appContainer").style.display = "none";
    const errorBanner = document.getElementById("loginError");
    if (errorMsg) {
        document.getElementById("loginErrorMsg").textContent = errorMsg;
        errorBanner.style.display = "flex";
    } else {
        errorBanner.style.display = "none";
    }
}

function hideLoginScreen() {
    document.getElementById("loginOverlay").style.display = "none";
    document.getElementById("appContainer").style.display = "block";
    if (currentUser) {
        document.getElementById("loggedInUsername").textContent = currentUser.username;
    }
}

async function checkAuthStatus() {
    if (!authToken) {
        showLoginScreen();
        return false;
    }
    try {
        const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
            method: "GET",
            headers: getAuthHeaders()
        });
        if (!res.ok) {
            throw new Error("Session expired");
        }
        const data = await res.json();
        if (data.authenticated && data.user) {
            currentUser = data.user;
            hideLoginScreen();
            return true;
        } else {
            throw new Error("Unauthenticated");
        }
    } catch (err) {
        authToken = null;
        localStorage.removeItem("salarytrack_token");
        showLoginScreen("Session expired. Please log in.");
        return false;
    }
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const usernameInput = document.getElementById("loginUsername");
    const passwordInput = document.getElementById("loginPassword");
    const submitBtn = document.getElementById("btnLoginSubmit");
    const errorBanner = document.getElementById("loginError");

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        document.getElementById("loginErrorMsg").textContent = "Please enter both username and password.";
        errorBanner.style.display = "flex";
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Signing in...`;
    errorBanner.style.display = "none";

    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Login failed");
        }

        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem("salarytrack_token", authToken);
        passwordInput.value = "";

        hideLoginScreen();
        showToast(`Welcome back, ${currentUser.username}!`, "success");

        await loadAppData();
    } catch (err) {
        document.getElementById("loginErrorMsg").textContent = err.message || "Invalid username or password";
        errorBanner.style.display = "flex";
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Sign In`;
    }
}

async function handleLogout() {
    if (authToken) {
        try {
            await fetch(`${API_BASE_URL}/api/auth/logout`, {
                method: "POST",
                headers: getAuthHeaders()
            });
        } catch (e) {
            console.warn("Logout request error:", e);
        }
    }
    authToken = null;
    currentUser = null;
    localStorage.removeItem("salarytrack_token");
    showLoginScreen();
    showToast("Logged out successfully.", "info");
}

async function loadAppData() {
    // 1. Initialize Date Selectors
    const monthSelector = document.getElementById("monthSelector");

    selectedYear = 2026;
    selectedMonthIndex = 7;
    monthSelector.value = "2026-08";

    // 2. Load shared data from Cloudflare Worker/D1 backend
    isLoadingFromServer = true;
    try {
        const response = await fetch(`${API_BASE_URL}/api/state`, {
            method: "GET",
            headers: getAuthHeaders()
        });

        if (response.status === 401) {
            handleLogout();
            return;
        }

        if (!response.ok) {
            throw new Error(`Backend returned HTTP ${response.status}`);
        }

        const payload = await response.json();

        if (Array.isArray(payload.employees) && payload.employees.length > 0) {
            employees = payload.employees;
            localStorage.setItem("salarytrack_state", JSON.stringify(employees));
        } else {
            const storedState = localStorage.getItem("salarytrack_state");
            if (storedState) {
                try {
                    employees = JSON.parse(storedState);
                } catch {
                    employees = [...defaultEmployees];
                }
            } else {
                employees = [...defaultEmployees];
            }

            // Upload default data
            employees.forEach(emp => {
                queueSyncOperation({ type: "employee_upsert", payload: { id: emp.id, name: emp.name, hourlyRate: emp.hourlyRate, incentiveRate: emp.incentiveRate, shiftDuration: emp.shiftDuration || 8, woNumber: emp.woNumber, contractorName: emp.contractorName } });
                Object.entries(emp.hours || {}).forEach(([date, hrs]) => {
                    queueSyncOperation({ type: "attendance_upsert", payload: { employeeId: emp.id, date, hours: hrs } });
                });
                (emp.advances || []).forEach(adv => {
                    queueSyncOperation({ type: "advance_upsert", payload: { id: adv.id, employeeId: emp.id, date: adv.date, amount: adv.amount, notes: adv.notes } });
                });
            });
        }
    } catch (error) {
        console.warn("Backend unavailable. Using local cached/demo data.", error);

        const storedState = localStorage.getItem("salarytrack_state");
        if (storedState) {
            try {
                employees = JSON.parse(storedState);
            } catch {
                employees = [...defaultEmployees];
            }
        } else {
            employees = [...defaultEmployees];
            localStorage.setItem("salarytrack_state", JSON.stringify(employees));
        }

        showToast("Backend unavailable — using local data.", "info");
    } finally {
        isLoadingFromServer = false;
    }

    registerEventListeners();
    renderApp();
}

function registerEventListeners() {
    // Month selector change
    const monthSelector = document.getElementById("monthSelector");
    monthSelector.addEventListener("change", (e) => {
        if (!e.target.value) return;
        const [year, month] = e.target.value.split("-");
        selectedYear = parseInt(year);
        selectedMonthIndex = parseInt(month) - 1;
        renderApp();
        showToast(`Switched month to ${monthSelector.options ? monthSelector.options[monthSelector.selectedIndex].text : e.target.value}`, "info");
    });

    // Employee search query
    const employeeSearch = document.getElementById("employeeSearch");
    employeeSearch.addEventListener("input", (e) => {
        searchQuery = e.target.value.trim();
        renderTable();
        updateKPIs();
    });

    // Contractor dropdown filter
    const contractorFilter = document.getElementById("contractorFilter");
    if (contractorFilter) {
        contractorFilter.addEventListener("change", (e) => {
            selectedContractorFilter = e.target.value;
            renderTable();
            updateKPIs();
        });
    }

    // Modal Triggers & Controls
    document.getElementById("btnAddEmployee").addEventListener("click", () => openAddEmployeeModal());
    document.getElementById("btnEmptyStateAdd").addEventListener("click", () => openAddEmployeeModal());
    
    // Close Modal event delegation
    document.querySelectorAll(".modal-close-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const modalId = btn.getAttribute("data-close");
            closeModal(modalId);
        });
    });

    // Employee Form Submission (Add/Edit)
    document.getElementById("employeeForm").addEventListener("submit", handleEmployeeFormSubmit);

    // Advance Form Submission
    document.getElementById("advanceForm").addEventListener("submit", handleAdvanceFormSubmit);

    // Export buttons
    document.getElementById("btnExportCSV").addEventListener("click", exportToCSV);
    document.getElementById("btnExportJSON").addEventListener("click", exportToJSON);
    
    // Import triggers
    const importInput = document.getElementById("importJSONInput");
    const importTrigger = document.getElementById("btnImportJSONTrigger");
    importTrigger.addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", handleJSONImport);
}

// ==========================================================================
// Rendering Controller
// ==========================================================================
function renderApp() {
    populateContractorFilter();
    renderTable();
    updateKPIs();
}

function getFilteredEmployees() {
    const query = searchQuery.toLowerCase();
    const contractorSelect = document.getElementById("contractorFilter");
    const selectedContractor = contractorSelect ? contractorSelect.value : selectedContractorFilter;

    return employees.filter(emp => {
        // 1. Contractor Dropdown Filter
        if (selectedContractor !== "ALL") {
            const empContractor = (emp.contractorName || "").trim();
            if (selectedContractor === "__UNASSIGNED__") {
                if (empContractor !== "") return false;
            } else if (empContractor.toLowerCase() !== selectedContractor.toLowerCase()) {
                return false;
            }
        }

        // 2. Multi-field search filter (Name, Contractor, WO Number, Rate, Incentive, etc.)
        if (!query) return true;
        const nameMatch = emp.name.toLowerCase().includes(query);
        const contractorMatch = (emp.contractorName || "").toLowerCase().includes(query);
        const woMatch = (emp.woNumber || "").toLowerCase().includes(query);
        const rateMatch = String(emp.hourlyRate).includes(query);
        const incentiveMatch = String(emp.incentiveRate || 0).includes(query);
        return nameMatch || contractorMatch || woMatch || rateMatch || incentiveMatch;
    });
}

function populateContractorFilter() {
    const select = document.getElementById("contractorFilter");
    if (!select) return;

    const currentVal = select.value || selectedContractorFilter || "ALL";
    const contractorSet = new Set();
    let hasUnassigned = false;

    employees.forEach(emp => {
        const cName = (emp.contractorName || "").trim();
        if (cName) {
            contractorSet.add(cName);
        } else {
            hasUnassigned = true;
        }
    });

    const sortedContractors = Array.from(contractorSet).sort();

    let html = `<option value="ALL">All Contractors</option>`;
    sortedContractors.forEach(c => {
        html += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
    });
    if (hasUnassigned) {
        html += `<option value="__UNASSIGNED__">Unassigned Contractor</option>`;
    }

    select.innerHTML = html;
    
    // Preserve selection if valid
    if (Array.from(select.options).some(opt => opt.value === currentVal)) {
        select.value = currentVal;
    } else {
        select.value = "ALL";
    }
}

function getDaysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
}

function formatDateKey(year, monthIndex, day) {
    const yyyy = year;
    const mm = String(monthIndex + 1).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function calculateTotalAdvancesForMonth(employee, year, monthIndex) {
    if (!employee.advances) return 0;
    const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    return employee.advances
        .filter(adv => adv.date.startsWith(prefix))
        .reduce((sum, adv) => sum + parseFloat(adv.amount || 0), 0);
}

function formatDaysDisplay(totalHours, shiftDuration) {
    const shift = parseFloat(shiftDuration) || 8;
    if (shift <= 0) return "0.0 d";
    const days = totalHours / shift;
    return `${days.toFixed(1)} d`;
}

function renderTable() {
    const daysInMonth = getDaysInMonth(selectedYear, selectedMonthIndex);
    const tableHead = document.getElementById("tableHead");
    const tableBody = document.getElementById("tableBody");
    const emptyState = document.getElementById("emptyState");
    const tableWrapper = document.getElementById("tableWrapper");

    // 1. Generate Header Rows
    let headHtml = `
        <tr>
            <th class="sticky-col-left col-emp-name">Employee Name</th>
            <th class="sticky-col-left col-emp-wo">WO Number</th>
            <th class="sticky-col-left col-emp-contractor">Contractor Name</th>
            <th class="sticky-col-left col-emp-rate">Rate/Hr</th>
            <th class="sticky-col-left col-emp-incentive">Incentive/Hr</th>
            <th class="sticky-col-left col-shift-duration">Shift Hrs</th>
    `;

    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(selectedYear, selectedMonthIndex, d);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        headHtml += `
            <th class="col-day-cell day-header">
                <span class="date-num">${d}</span>
                <span class="date-name">${dayName}</span>
            </th>
        `;
    }

    headHtml += `
            <th class="sticky-col-right col-total-hours">Total Hrs</th>
            <th class="sticky-col-right col-days-worked">Days Worked</th>
            <th class="sticky-col-right col-gross-pay">Gross Pay</th>
            <th class="sticky-col-right col-advances">Advances</th>
            <th class="sticky-col-right col-net-pay">Net Pay</th>
            <th class="sticky-col-right col-actions">Actions</th>
        </tr>
    `;
    tableHead.innerHTML = headHtml;

    // 2. Filter employees by contractor and search criteria
    const filtered = getFilteredEmployees();

    if (filtered.length === 0) {
        tableWrapper.style.display = "none";
        emptyState.style.display = "flex";
        return;
    }

    tableWrapper.style.display = "block";
    emptyState.style.display = "none";

    // 3. Render Employee Data Rows
    let bodyHtml = "";
    filtered.forEach(emp => {
        let empTotalHours = 0;
        let dayCellsHtml = "";

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = formatDateKey(selectedYear, selectedMonthIndex, d);
            const rawVal = emp.hours[dateStr];
            const hasValue = rawVal !== undefined && rawVal !== "";
            
            let displayH = "";
            let displayM = "";
            if (hasValue) {
                const totalMinutes = Math.round(parseFloat(rawVal) * 60);
                displayH = Math.floor(totalMinutes / 60);
                displayM = totalMinutes % 60;
                empTotalHours += parseFloat(rawVal);
            }

            let cellClass = "hm-cell";
            if (hasValue && parseFloat(rawVal) > 0) {
                cellClass += parseFloat(rawVal) > 8 ? " has-overtime" : " has-hours";
            }

            dayCellsHtml += `
                <td class="col-day-cell">
                    <div class="${cellClass}" data-emp-id="${emp.id}" data-date="${dateStr}">
                        <input type="text" 
                               class="hm-input hm-hour" 
                               value="${hasValue ? displayH : ''}" 
                               placeholder="h"
                               maxlength="2"
                               inputmode="numeric"
                               oninput="handleHMInput(this)">
                        <span class="hm-sep">:</span>
                        <input type="text" 
                               class="hm-input hm-min" 
                               value="${hasValue ? String(displayM).padStart(2, '0') : ''}" 
                               placeholder="m"
                               maxlength="2"
                               inputmode="numeric"
                               oninput="handleHMInput(this)">
                    </div>
                </td>
            `;
        }

        const incentiveRate = emp.incentiveRate || 0;
        const shiftDuration = emp.shiftDuration !== undefined ? emp.shiftDuration : 8;
        const basePay = empTotalHours * emp.hourlyRate;
        const incentivePay = empTotalHours * incentiveRate;
        const grossPay = basePay + incentivePay;
        const totalAdvances = calculateTotalAdvancesForMonth(emp, selectedYear, selectedMonthIndex);
        const netPay = grossPay - totalAdvances;

        bodyHtml += `
            <tr id="row-${emp.id}">
                <td class="sticky-col-left col-emp-name">
                    <span class="employee-name-text" title="${escapeHtml(emp.name)}">${escapeHtml(emp.name)}</span>
                </td>
                <td class="sticky-col-left col-emp-wo">
                    <span class="employee-wo-value">${escapeHtml(emp.woNumber || '')}</span>
                </td>
                <td class="sticky-col-left col-emp-contractor">
                    <span class="employee-contractor-value">${escapeHtml(emp.contractorName || '')}</span>
                </td>
                <td class="sticky-col-left col-emp-rate">
                    <div class="employee-rate-cell">
                        <span class="employee-rate-value">₹${emp.hourlyRate}</span>
                    </div>
                </td>
                <td class="sticky-col-left col-emp-incentive">
                    <div class="employee-rate-cell">
                        <span class="employee-rate-value">₹${emp.incentiveRate || 0}</span>
                    </div>
                </td>
                <td class="sticky-col-left col-shift-duration">
                    <div class="shift-duration-cell">
                        <input type="number" 
                               class="shift-input" 
                               value="${shiftDuration}" 
                               min="1" max="24" step="0.5" 
                               data-emp-id="${emp.id}"
                               onchange="handleShiftDurationChange('${emp.id}', this.value)"
                               oninput="handleShiftDurationChange('${emp.id}', this.value)"
                               title="Shift Duration (Hours)">
                        <span class="shift-unit">h</span>
                    </div>
                </td>
                ${dayCellsHtml}
                <td class="sticky-col-right col-total-hours">
                    <span class="hours-value" id="hours-${emp.id}">${formatHoursDisplay(empTotalHours)}</span>
                </td>
                <td class="sticky-col-right col-days-worked">
                    <span class="days-value" id="days-${emp.id}">${formatDaysDisplay(empTotalHours, shiftDuration)}</span>
                </td>
                <td class="sticky-col-right col-gross-pay">
                    <span class="gross-value" id="gross-${emp.id}">₹${grossPay.toFixed(2)}</span>
                </td>
                <td class="sticky-col-right col-advances">
                    <button type="button" class="btn-manage-advances" onclick="openAdvancesModal('${emp.id}')" id="adv-btn-${emp.id}">
                        ₹${totalAdvances.toFixed(2)}
                    </button>
                </td>
                <td class="sticky-col-right col-net-pay">
                    <span class="net-value" id="net-${emp.id}">₹${netPay.toFixed(2)}</span>
                </td>
                <td class="sticky-col-right col-actions">
                    <div class="actions-cell-group">
                        <button type="button" class="btn-action-icon btn-edit" onclick="openEditEmployeeModal('${emp.id}')" title="Edit Employee">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <button type="button" class="btn-action-icon btn-trash" onclick="deleteEmployee('${emp.id}')" title="Delete Employee">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = bodyHtml;
}

function updateKPIs() {
    const filtered = getFilteredEmployees();
    
    let totalEmployees = filtered.length;
    let totalHours = 0;
    let totalDays = 0;
    let grossSalary = 0;
    let totalAdvances = 0;
    let netPayout = 0;

    filtered.forEach(emp => {
        // Calculate hours sum for selected month
        let empHours = 0;
        const daysInMonth = getDaysInMonth(selectedYear, selectedMonthIndex);
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = formatDateKey(selectedYear, selectedMonthIndex, d);
            const hrs = emp.hours[dateStr] !== undefined ? emp.hours[dateStr] : "";
            if (hrs !== "") {
                empHours += parseFloat(hrs);
            }
        }

        const shiftDuration = emp.shiftDuration !== undefined ? parseFloat(emp.shiftDuration) : 8;
        const empDays = shiftDuration > 0 ? empHours / shiftDuration : 0;
        const empIncentiveRate = emp.incentiveRate || 0;
        const empBasePay = empHours * emp.hourlyRate;
        const empIncentivePay = empHours * empIncentiveRate;
        const empGross = empBasePay + empIncentivePay;
        const empAdvances = calculateTotalAdvancesForMonth(emp, selectedYear, selectedMonthIndex);
        const empNet = empGross - empAdvances;

        totalHours += empHours;
        totalDays += empDays;
        grossSalary += empGross;
        totalAdvances += empAdvances;
        netPayout += empNet;
    });

    document.getElementById("valTotalEmployees").textContent = totalEmployees;
    document.getElementById("valTotalHours").textContent = formatHoursDisplay(totalHours);
    const valDaysEl = document.getElementById("valTotalDays");
    if (valDaysEl) valDaysEl.textContent = totalDays.toFixed(1);
    document.getElementById("valTotalGross").textContent = "₹" + grossSalary.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById("valTotalAdvances").textContent = "₹" + totalAdvances.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    document.getElementById("valTotalNet").textContent = "₹" + netPayout.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Formats decimal hours as "Xh Ym"
function formatHoursDisplay(decimalHours) {
    const totalMinutes = Math.round(decimalHours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

// ==========================================================================
// Hours Input Handler (Sheet Cell updates) - Hours:Minutes dual input
// ==========================================================================
function handleHMInput(inputElement) {
    // Only allow digits
    inputElement.value = inputElement.value.replace(/[^0-9]/g, '');
    
    const cellDiv = inputElement.closest('.hm-cell');
    const empId = cellDiv.getAttribute("data-emp-id");
    const dateStr = cellDiv.getAttribute("data-date");
    
    const hourInput = cellDiv.querySelector('.hm-hour');
    const minInput = cellDiv.querySelector('.hm-min');
    
    const hVal = hourInput.value.trim();
    const mVal = minInput.value.trim();

    const emp = employees.find(e => e.id === empId);
    if (!emp) return;

    // If both empty, remove entry
    if (hVal === "" && mVal === "") {
        delete emp.hours[dateStr];
        cellDiv.className = "hm-cell";
        queueSyncOperation({ type: "attendance_delete", payload: { employeeId: empId, date: dateStr } });
    } else {
        let hours = parseInt(hVal) || 0;
        let minutes = parseInt(mVal) || 0;
        
        // Clamp values
        hours = Math.min(24, Math.max(0, hours));
        minutes = Math.min(59, Math.max(0, minutes));
        
        // If hours is 24, minutes must be 0
        if (hours >= 24) {
            hours = 24;
            minutes = 0;
        }
        
        const decimalHours = hours + (minutes / 60);
        emp.hours[dateStr] = decimalHours;
        queueSyncOperation({ type: "attendance_upsert", payload: { employeeId: empId, date: dateStr, hours: decimalHours } });
        
        // Dynamic coloring classes
        let newClass = "hm-cell";
        if (decimalHours > 0) {
            newClass += decimalHours > 8 ? " has-overtime" : " has-hours";
        }
        cellDiv.className = newClass;
    }

    // Auto-advance: when hour input has 2 digits, jump to minute input
    if (inputElement.classList.contains('hm-hour') && hVal.length >= 2) {
        minInput.focus();
        minInput.select();
    }

    saveStateToStorage();
    recalculateRow(empId);
    updateKPIs();
}

function handleShiftDurationChange(empId, val) {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;
    const num = parseFloat(val);
    if (isNaN(num) || num <= 0) return;
    emp.shiftDuration = num;
    queueSyncOperation({
        type: "employee_upsert",
        payload: {
            id: emp.id,
            name: emp.name,
            hourlyRate: emp.hourlyRate,
            incentiveRate: emp.incentiveRate,
            shiftDuration: emp.shiftDuration,
            woNumber: emp.woNumber,
            contractorName: emp.contractorName
        }
    });
    saveStateToStorage();
    recalculateRow(empId);
    updateKPIs();
}

function recalculateRow(empId) {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;

    let empTotalHours = 0;
    const daysInMonth = getDaysInMonth(selectedYear, selectedMonthIndex);
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = formatDateKey(selectedYear, selectedMonthIndex, d);
        const hrs = emp.hours[dateStr] !== undefined ? emp.hours[dateStr] : "";
        if (hrs !== "") {
            empTotalHours += parseFloat(hrs);
        }
    }

    const incentiveRate = emp.incentiveRate || 0;
    const shiftDuration = emp.shiftDuration !== undefined ? emp.shiftDuration : 8;
    const basePay = empTotalHours * emp.hourlyRate;
    const incentivePay = empTotalHours * incentiveRate;
    const grossPay = basePay + incentivePay;
    const totalAdvances = calculateTotalAdvancesForMonth(emp, selectedYear, selectedMonthIndex);
    const netPay = grossPay - totalAdvances;

    // Update DOM nodes directly for extreme speed and fluid feels
    const hrsEl = document.getElementById(`hours-${empId}`);
    if (hrsEl) hrsEl.textContent = formatHoursDisplay(empTotalHours);
    
    const daysEl = document.getElementById(`days-${empId}`);
    if (daysEl) daysEl.textContent = formatDaysDisplay(empTotalHours, shiftDuration);

    const grossEl = document.getElementById(`gross-${empId}`);
    if (grossEl) grossEl.textContent = `₹${grossPay.toFixed(2)}`;

    const advEl = document.getElementById(`adv-btn-${empId}`);
    if (advEl) advEl.textContent = `₹${totalAdvances.toFixed(2)}`;

    const netEl = document.getElementById(`net-${empId}`);
    if (netEl) netEl.textContent = `₹${netPay.toFixed(2)}`;
}

// ==========================================================================
// Employee Management (Modal Add / Edit)
// ==========================================================================
function openAddEmployeeModal() {
    editingEmployeeId = null;
    document.getElementById("employeeModalTitle").textContent = "Add New Employee";
    document.getElementById("employeeForm").reset();
    document.getElementById("newEmployeeShiftDuration").value = 8;
    openModal("employeeModal");
}

function openEditEmployeeModal(empId) {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;
    
    editingEmployeeId = empId;
    document.getElementById("employeeModalTitle").textContent = "Edit Employee Details";
    document.getElementById("newEmployeeName").value = emp.name;
    document.getElementById("newEmployeeWO").value = emp.woNumber || "";
    document.getElementById("newEmployeeContractor").value = emp.contractorName || "";
    document.getElementById("newEmployeeRate").value = emp.hourlyRate;
    document.getElementById("newEmployeeIncentiveRate").value = emp.incentiveRate || 0;
    document.getElementById("newEmployeeShiftDuration").value = emp.shiftDuration !== undefined ? emp.shiftDuration : 8;
    openModal("employeeModal");
}

// ==========================================================================
// Form Submission, Updates, Actions
// ==========================================================================
function handleEmployeeFormSubmit(e) {
    e.preventDefault();
    const nameInput = document.getElementById("newEmployeeName");
    const woInput = document.getElementById("newEmployeeWO");
    const contractorInput = document.getElementById("newEmployeeContractor");
    const rateInput = document.getElementById("newEmployeeRate");
    const incentiveRateInput = document.getElementById("newEmployeeIncentiveRate");
    const shiftDurationInput = document.getElementById("newEmployeeShiftDuration");
    
    const nameVal = nameInput.value.trim();
    const woVal = woInput.value.trim();
    const contractorVal = contractorInput.value.trim();
    const rateVal = parseFloat(rateInput.value) || 0;
    const incentiveRateVal = parseFloat(incentiveRateInput.value) || 0;
    const shiftDurationVal = parseFloat(shiftDurationInput.value) || 8;

    if (!nameVal || rateVal < 0 || shiftDurationVal <= 0) {
        showToast("Please enter valid employee details", "error");
        return;
    }

    if (editingEmployeeId) {
        // Edit Mode
        const emp = employees.find(e => e.id === editingEmployeeId);
        if (emp) {
            emp.name = nameVal;
            emp.woNumber = woVal;
            emp.contractorName = contractorVal;
            emp.hourlyRate = rateVal;
            emp.incentiveRate = incentiveRateVal;
            emp.shiftDuration = shiftDurationVal;
            queueSyncOperation({ type: "employee_upsert", payload: { id: emp.id, name: emp.name, hourlyRate: emp.hourlyRate, incentiveRate: emp.incentiveRate, shiftDuration: emp.shiftDuration, woNumber: emp.woNumber, contractorName: emp.contractorName } });
            showToast(`Employee "${nameVal}" updated successfully!`, "success");
        }
    } else {
        // Add Mode
        const newEmp = {
            id: "emp-" + Date.now(),
            name: nameVal,
            woNumber: woVal,
            contractorName: contractorVal,
            hourlyRate: rateVal,
            incentiveRate: incentiveRateVal,
            shiftDuration: shiftDurationVal,
            hours: {},
            advances: []
        };
        employees.push(newEmp);
        queueSyncOperation({ type: "employee_upsert", payload: { id: newEmp.id, name: newEmp.name, hourlyRate: newEmp.hourlyRate, incentiveRate: newEmp.incentiveRate, shiftDuration: newEmp.shiftDuration, woNumber: newEmp.woNumber, contractorName: newEmp.contractorName } });
        showToast(`Employee "${nameVal}" added successfully!`, "success");
    }

    saveStateToStorage();
    closeModal("employeeModal");
    renderApp();
}

function deleteEmployee(empId) {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;

    if (confirm(`Are you sure you want to delete employee "${emp.name}"? All hour logs and advances for this employee will be permanently removed.`)) {
        queueSyncOperation({ type: "employee_delete", payload: { id: empId } });
        employees = employees.filter(e => e.id !== empId);
        saveStateToStorage();
        renderApp();
        showToast(`Employee "${emp.name}" deleted.`, "info");
    }
}

// ==========================================================================
// Advances Ledger & Modal Management
// ==========================================================================
function openAdvancesModal(empId) {
    const emp = employees.find(e => e.id === empId);
    if (!emp) return;

    currentEmployeeForAdvances = empId;
    
    // Set Header Info
    document.getElementById("advModalEmpName").textContent = emp.name;
    
    // Configure default date in form to today, or if today is outside selected month, default to first day of selected month
    const today = new Date();
    const isTodayInSelectedMonth = today.getFullYear() === selectedYear && today.getMonth() === selectedMonthIndex;
    const dateInput = document.getElementById("advDate");
    
    if (isTodayInSelectedMonth) {
        dateInput.value = today.toISOString().split("T")[0];
    } else {
        dateInput.value = formatDateKey(selectedYear, selectedMonthIndex, 1);
    }
    
    // Set bounds on the date picker to prevent recording advance outside the current active month
    const totalDays = getDaysInMonth(selectedYear, selectedMonthIndex);
    dateInput.min = formatDateKey(selectedYear, selectedMonthIndex, 1);
    dateInput.max = formatDateKey(selectedYear, selectedMonthIndex, totalDays);

    // Clear form inputs
    document.getElementById("advAmount").value = "";
    document.getElementById("advNotes").value = "";

    // Set Month Ledger labels
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    document.getElementById("ledgerMonthLabel").textContent = `${monthNames[selectedMonthIndex]} ${selectedYear}`;

    renderAdvancesLedger();
    openModal("advancesModal");
}

function renderAdvancesLedger() {
    const emp = employees.find(e => e.id === currentEmployeeForAdvances);
    if (!emp) return;

    const totalAdvances = calculateTotalAdvancesForMonth(emp, selectedYear, selectedMonthIndex);
    document.getElementById("advModalEmpTotal").textContent = `₹${totalAdvances.toFixed(2)}`;

    const ledgerBody = document.getElementById("ledgerBody");
    const emptyLedger = document.getElementById("emptyLedger");

    // Filter advances for current active month
    const prefix = `${selectedYear}-${String(selectedMonthIndex + 1).padStart(2, '0')}`;
    const monthlyAdvances = (emp.advances || []).filter(adv => adv.date.startsWith(prefix));

    // Sort by date ascending
    monthlyAdvances.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (monthlyAdvances.length === 0) {
        ledgerBody.innerHTML = "";
        emptyLedger.style.display = "block";
        return;
    }

    emptyLedger.style.display = "none";
    
    let html = "";
    monthlyAdvances.forEach(adv => {
        // Pretty date format: e.g. 02 Aug 2026
        const dObj = new Date(adv.date);
        const formattedDate = dObj.toLocaleDateString("en-IN", { day: '2-digit', month: 'short', year: 'numeric' });

        html += `
            <tr>
                <td><strong>${formattedDate}</strong></td>
                <td class="text-danger" style="font-weight: 600;">₹${parseFloat(adv.amount).toFixed(2)}</td>
                <td><span class="text-secondary">${escapeHtml(adv.notes || '—')}</span></td>
                <td style="text-align: right;">
                    <button type="button" class="btn-trash" onclick="deleteAdvance('${adv.id}')" title="Delete Advance">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    ledgerBody.innerHTML = html;
}

function handleAdvanceFormSubmit(e) {
    e.preventDefault();
    if (!currentEmployeeForAdvances) return;

    const emp = employees.find(e => e.id === currentEmployeeForAdvances);
    if (!emp) return;

    const dateInput = document.getElementById("advDate");
    const amountInput = document.getElementById("advAmount");
    const notesInput = document.getElementById("advNotes");

    const dateVal = dateInput.value;
    const amountVal = parseFloat(amountInput.value) || 0;
    const notesVal = notesInput.value.trim();

    if (!dateVal || amountVal <= 0) {
        showToast("Please enter a valid date and amount", "error");
        return;
    }

    // Verify date is within selected month
    const dateObj = new Date(dateVal);
    if (dateObj.getFullYear() !== selectedYear || dateObj.getMonth() !== selectedMonthIndex) {
        showToast("Advance payment must be recorded within the selected payroll month", "error");
        return;
    }

    // Insert advance
    if (!emp.advances) emp.advances = [];
    
    const newAdvance = {
        id: "adv-" + Date.now(),
        date: dateVal,
        amount: amountVal,
        notes: notesVal
    };

    emp.advances.push(newAdvance);
    queueSyncOperation({ type: "advance_upsert", payload: { id: newAdvance.id, employeeId: emp.id, date: newAdvance.date, amount: newAdvance.amount, notes: newAdvance.notes } });
    saveStateToStorage();
    
    // UI Update
    renderAdvancesLedger();
    recalculateRow(currentEmployeeForAdvances);
    updateKPIs();
    
    showToast(`Recorded ₹${amountVal.toFixed(2)} advance for ${emp.name}`, "success");
    
    // Reset form fields
    amountInput.value = "";
    notesInput.value = "";
}

function deleteAdvance(advanceId) {
    if (!currentEmployeeForAdvances) return;
    const emp = employees.find(e => e.id === currentEmployeeForAdvances);
    if (!emp) return;

    const adv = emp.advances.find(a => a.id === advanceId);
    const amountStr = adv ? `₹${adv.amount.toFixed(2)}` : "";

    if (confirm(`Remove this advance payment record of ${amountStr}? This will adjust the employee's payout.`)) {
        queueSyncOperation({ type: "advance_delete", payload: { id: advanceId } });
        emp.advances = emp.advances.filter(a => a.id !== advanceId);
        saveStateToStorage();
        
        renderAdvancesLedger();
        recalculateRow(currentEmployeeForAdvances);
        updateKPIs();
        
        showToast(`Advance record removed successfully.`, "info");
    }
}

// ==========================================================================
// Modal UI Helper Actions
// ==========================================================================
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add("active");
        modal.setAttribute("aria-hidden", "false");
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove("active");
        modal.setAttribute("aria-hidden", "true");
        if (modalId === "employeeModal") {
            editingEmployeeId = null;
        } else if (modalId === "advancesModal") {
            currentEmployeeForAdvances = null;
        }
    }
}

// ==========================================================================
// State Storage Persistence
// ==========================================================================
function saveStateToStorage() {
    // Keep an immediate local cache so the UI remains responsive/offline.
    localStorage.setItem("salarytrack_state", JSON.stringify(employees));
}

function queueSyncOperation(operation) {
    syncQueue.push(operation);
    if (isLoadingFromServer) return;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        processSyncQueue();
    }, 500);
}

async function processSyncQueue() {
    if (isSyncing || syncQueue.length === 0) return;

    isSyncing = true;
    const batch = [...syncQueue];
    syncQueue = []; // Clear queue so new items can be added while syncing

    try {
        const response = await fetch(`${API_BASE_URL}/api/sync`, {
            method: "POST",
            headers: {
                ...getAuthHeaders(),
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ operations: batch })
        });

        if (response.status === 401) {
            handleLogout();
            return;
        }

        if (!response.ok) {
            const message = await response.text();
            throw new Error(`HTTP ${response.status}: ${message}`);
        }
    } catch (error) {
        console.error("Failed to sync batch with backend:", error);
        // Put failed operations back at the front of the queue
        syncQueue = [...batch, ...syncQueue];
        showToast("Could not sync to server. Will retry automatically.", "error");

        // Wait before next retry if there's a failure
        setTimeout(() => {
            isSyncing = false;
            if (syncQueue.length > 0) processSyncQueue();
        }, 5000);
        return;
    }

    isSyncing = false;
    // If more items were added during the sync, process them now
    if (syncQueue.length > 0) {
        processSyncQueue();
    }
}

// ==========================================================================
// CSV & Backup Data Ports (Import/Export)
// ==========================================================================
function exportToCSV() {
    const daysInMonth = getDaysInMonth(selectedYear, selectedMonthIndex);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const fileLabel = `${monthNames[selectedMonthIndex]}_${selectedYear}`;

    // 1. Compile Header
    let csvContent = "Employee Name,WO Number,Contractor Name,Hourly Rate (INR),Incentive Rate (INR),Shift Duration (Hrs),";
    for (let d = 1; d <= daysInMonth; d++) {
        csvContent += `Day ${d},`;
    }
    csvContent += "Total Hours,Days Worked,Base Pay (INR),Incentive Pay (INR),Gross Pay (INR),Total Advances (INR),Net Pay (INR)\n";

    // 2. Build rows
    employees.forEach(emp => {
        let empTotalHours = 0;
        let daysHrsString = "";

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = formatDateKey(selectedYear, selectedMonthIndex, d);
            const hrs = emp.hours[dateStr] !== undefined ? emp.hours[dateStr] : 0;
            empTotalHours += parseFloat(hrs);
            daysHrsString += `${hrs},`;
        }

        const incentiveRate = emp.incentiveRate || 0;
        const shiftDuration = emp.shiftDuration !== undefined ? emp.shiftDuration : 8;
        const daysWorked = (empTotalHours / (shiftDuration || 8)).toFixed(1);
        const basePay = empTotalHours * emp.hourlyRate;
        const incentivePay = empTotalHours * incentiveRate;
        const gross = basePay + incentivePay;
        const advances = calculateTotalAdvancesForMonth(emp, selectedYear, selectedMonthIndex);
        const net = gross - advances;

        // Escape comma in employee names if any
        const safeName = `"${emp.name.replace(/"/g, '""')}"`;

        const safeWO = `"${(emp.woNumber || '').replace(/"/g, '""')}"`;
        const safeContractor = `"${(emp.contractorName || '').replace(/"/g, '""')}"`;
        csvContent += `${safeName},${safeWO},${safeContractor},${emp.hourlyRate},${incentiveRate},${shiftDuration},${daysHrsString}${empTotalHours.toFixed(1)},${daysWorked},${basePay.toFixed(2)},${incentivePay.toFixed(2)},${gross.toFixed(2)},${advances.toFixed(2)},${net.toFixed(2)}\n`;

    });

    // 3. Download Blob
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `SalaryTrack_Report_${fileLabel}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`CSV Payroll report downloaded.`, "success");
}

function exportToJSON() {
    const dateStr = new Date().toISOString().split("T")[0];
    const dataStr = JSON.stringify(employees, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `SalaryTrack_Backup_${dateStr}.json`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Database backup downloaded successfully.`, "success");
}

function handleJSONImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const parsed = JSON.parse(evt.target.result);
            
            // Basic Structural Verification
            if (!Array.isArray(parsed)) {
                throw new Error("Backup file must contain an array of employees.");
            }
            
            for (let i = 0; i < parsed.length; i++) {
                const item = parsed[i];
                if (!item.id || !item.name || item.hourlyRate === undefined || !item.hours) {
                    throw new Error(`Record at position ${i+1} is missing required fields (id, name, hourlyRate, hours).`);
                }
            }

            // Default missing fields for backwards compatibility
            parsed.forEach(item => {
                item.incentiveRate = item.incentiveRate || 0;
                item.shiftDuration = item.shiftDuration || 8;
            });

            // Restore state
            employees = parsed;
            saveStateToStorage();
            renderApp();
            showToast("Database restored successfully!", "success");
        } catch (err) {
            alert("Error parsing backup file: " + err.message);
            showToast("Restore failed. Check file format.", "error");
        }
    };
    reader.readAsText(file);
    // Reset file input value to allow uploading same file again
    e.target.value = "";
}

// ==========================================================================
// Toast Messaging Notification Helper
// ==========================================================================
function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    let icon = "fa-circle-check";
    if (type === "error") icon = "fa-triangle-exclamation";
    if (type === "info") icon = "fa-circle-info";
    
    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Automatically dismiss toast after 3.5s
    setTimeout(() => {
        toast.classList.add("toast-fade-out");
        toast.addEventListener("animationend", () => {
            toast.remove();
        });
    }, 3500);
}

// ==========================================================================
// Text Escaping Helper (Sanitization)
// ==========================================================================
function escapeHtml(string) {
    return String(string).replace(/[&<>"']/g, function (s) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[s];
    });
}
