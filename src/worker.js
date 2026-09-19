export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, x-session-token",
      "Access-Control-Max-Age": "86400",
    };

    // Preflight Response
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Helper: Ensure auth tables exist
    async function ensureAuthTables() {
      try {
        await env.DB.exec(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );
          CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          );
        `);
      } catch (e) {
        console.error("Table creation check failed:", e);
      }
    }

    // Helper: Password Hashing via Web Crypto API
    async function hashPassword(password, saltHex) {
      const encoder = new TextEncoder();
      const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      const passwordBuffer = encoder.encode(password);
      const combined = new Uint8Array(passwordBuffer.length + salt.length);
      combined.set(passwordBuffer);
      combined.set(salt, passwordBuffer.length);
      const hashBuffer = await crypto.subtle.digest("SHA-256", combined);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function generateSalt() {
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    }

    function generateToken() {
      return crypto.randomUUID();
    }

    // Helper: Authenticate session token
    async function authenticateRequest() {
      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim() || request.headers.get("x-session-token");
      if (!token) return null;

      try {
        await ensureAuthTables();
        const now = Date.now();
        const session = await env.DB.prepare(
          "SELECT s.token, s.expires_at, u.id as user_id, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?"
        ).bind(token).first();

        if (!session || session.expires_at < now) {
          if (session) {
            await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token);
          }
          return null;
        }

        return { id: session.user_id, username: session.username };
      } catch (e) {
        console.error("Auth verification error:", e);
        return null;
      }
    }

    // Endpoint: POST /api/auth/login
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      try {
        await ensureAuthTables();

        // Auto-seed default user if users table is empty
        const userCountRes = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
        if (!userCountRes || userCountRes.count === 0) {
          const defaultSalt = generateSalt();
          const defaultHash = await hashPassword("admin123", defaultSalt);
          await env.DB.prepare(
            "INSERT INTO users (id, username, password_hash, salt) VALUES (?, ?, ?, ?)"
          ).bind("user-admin-default", "admin", defaultHash, defaultSalt).run();
        }

        const body = await request.json();
        const { username, password } = body || {};

        if (!username || !password) {
          return new Response(JSON.stringify({ error: "Username and password are required" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const user = await env.DB.prepare(
          "SELECT id, username, password_hash, salt FROM users WHERE username = ?"
        ).bind(username.trim()).first();

        if (!user) {
          return new Response(JSON.stringify({ error: "Invalid username or password" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const computedHash = await hashPassword(password, user.salt);
        if (computedHash !== user.password_hash) {
          return new Response(JSON.stringify({ error: "Invalid username or password" }), {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        // Generate 7-day session token
        const token = generateToken();
        const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000);

        await env.DB.prepare(
          "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
        ).bind(token, user.id, expiresAt).run();

        return new Response(JSON.stringify({
          success: true,
          token,
          user: { username: user.username }
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
    }

    // Endpoint: GET /api/auth/me
    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      const user = await authenticateRequest();
      if (!user) {
        return new Response(JSON.stringify({ authenticated: false, error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ authenticated: true, user }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Endpoint: POST /api/auth/logout
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim() || request.headers.get("x-session-token");
      if (token) {
        await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Authenticate all remaining API endpoints
    const authUser = await authenticateRequest();
    if (!authUser) {
      return new Response(JSON.stringify({ error: "Unauthorized. Please log in." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Endpoint: /api/state
    if (url.pathname === "/api/state") {
      if (request.method === "GET") {
        try {
          // Batch fetch all data from relational tables
          const [employeesRes, hoursRes, advancesRes] = await env.DB.batch([
            env.DB.prepare("SELECT id, name, hourly_rate AS hourlyRate, incentive_rate AS incentiveRate, wo_number AS woNumber, contractor_name AS contractorName FROM employees"),
            env.DB.prepare("SELECT employee_id, date, hours FROM hours"),
            env.DB.prepare("SELECT id, employee_id, date, amount, notes FROM advances")
          ]);

          const employees = (employeesRes.results || []).map(emp => ({
            id: emp.id,
            name: emp.name,
            hourlyRate: Number(emp.hourlyRate),
            incentiveRate: Number(emp.incentiveRate || 0),
            woNumber: emp.woNumber || "",
            contractorName: emp.contractorName || "",
            hours: {},
            advances: []
          }));

          const empMap = new Map(employees.map(e => [e.id, e]));

          // Populate hours
          if (hoursRes.results) {
            for (const h of hoursRes.results) {
              const emp = empMap.get(h.employee_id);
              if (emp) {
                emp.hours[h.date] = Number(h.hours);
              }
            }
          }

          // Populate advances
          if (advancesRes.results) {
            for (const adv of advancesRes.results) {
              const emp = empMap.get(adv.employee_id);
              if (emp) {
                emp.advances.push({
                  id: adv.id,
                  date: adv.date,
                  amount: Number(adv.amount),
                  notes: adv.notes || ""
                });
              }
            }
          }

          return new Response(JSON.stringify({ employees }), {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
      }
    }

    // Endpoint: /api/sync
    if (url.pathname === "/api/sync" && request.method === "POST") {
      try {
        const body = await request.json();
        const { operations } = body;

        if (!Array.isArray(operations)) {
          return new Response(JSON.stringify({ error: "operations field must be an array" }), {
            status: 400,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }

        const statements = [];

        for (const op of operations) {
          if (!op.type || !op.payload) continue;

          switch (op.type) {
            case "employee_upsert": {
              const { id, name, hourlyRate, incentiveRate, woNumber, contractorName } = op.payload;
              statements.push(
                env.DB.prepare(
                  "INSERT INTO employees (id, name, hourly_rate, incentive_rate, wo_number, contractor_name) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, hourly_rate=excluded.hourly_rate, incentive_rate=excluded.incentive_rate, wo_number=excluded.wo_number, contractor_name=excluded.contractor_name"
                ).bind(id, name, Number(hourlyRate), Number(incentiveRate || 0), woNumber || "", contractorName || "")
              );
              break;
            }
            case "employee_delete": {
              const { id } = op.payload;
              statements.push(
                env.DB.prepare("DELETE FROM employees WHERE id = ?").bind(id)
              );
              break;
            }
            case "attendance_upsert": {
              const { employeeId, date, hours } = op.payload;
              statements.push(
                env.DB.prepare(
                  "INSERT INTO hours (employee_id, date, hours) VALUES (?, ?, ?) ON CONFLICT(employee_id, date) DO UPDATE SET hours=excluded.hours"
                ).bind(employeeId, date, Number(hours))
              );
              break;
            }
            case "attendance_delete": {
              const { employeeId, date } = op.payload;
              statements.push(
                env.DB.prepare("DELETE FROM hours WHERE employee_id = ? AND date = ?").bind(employeeId, date)
              );
              break;
            }
            case "advance_upsert": {
              const { id, employeeId, date, amount, notes } = op.payload;
              statements.push(
                env.DB.prepare(
                  "INSERT INTO advances (id, employee_id, date, amount, notes) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount, notes=excluded.notes, date=excluded.date"
                ).bind(id, employeeId, date, Number(amount), notes || "")
              );
              break;
            }
            case "advance_delete": {
              const { id } = op.payload;
              statements.push(
                env.DB.prepare("DELETE FROM advances WHERE id = ?").bind(id)
              );
              break;
            }
          }
        }

        if (statements.length > 0) {
          await env.DB.batch(statements);
        }

        return new Response(JSON.stringify({ success: true, processed: statements.length }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }

    // fallback to a 404 response for other paths
    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders
    });
  }
};
