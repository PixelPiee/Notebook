export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Max-Age": "86400",
    };

    // Preflight Response
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
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
