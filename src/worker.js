export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
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
            env.DB.prepare("SELECT id, name, hourly_rate AS hourlyRate FROM employees"),
            env.DB.prepare("SELECT employee_id, date, hours FROM hours"),
            env.DB.prepare("SELECT id, employee_id, date, amount, notes FROM advances")
          ]);

          const employees = (employeesRes.results || []).map(emp => ({
            id: emp.id,
            name: emp.name,
            hourlyRate: Number(emp.hourlyRate),
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

      if (request.method === "PUT") {
        try {
          const body = await request.json();
          const { employees } = body;

          if (!Array.isArray(employees)) {
            return new Response(JSON.stringify({ error: "employees field must be an array" }), {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
              }
            });
          }

          const statements = [];

          // Delete all current records in correct child-to-parent order to avoid FK violation errors
          statements.push(env.DB.prepare("DELETE FROM hours"));
          statements.push(env.DB.prepare("DELETE FROM advances"));
          statements.push(env.DB.prepare("DELETE FROM employees"));

          // Re-populate tables with latest client state
          for (const emp of employees) {
            statements.push(
              env.DB.prepare("INSERT INTO employees (id, name, hourly_rate) VALUES (?, ?, ?)")
                .bind(emp.id, emp.name, Number(emp.hourlyRate))
            );

            if (emp.hours && typeof emp.hours === "object") {
              for (const [date, hrs] of Object.entries(emp.hours)) {
                if (hrs !== null && hrs !== undefined && hrs !== "") {
                  statements.push(
                    env.DB.prepare("INSERT INTO hours (employee_id, date, hours) VALUES (?, ?, ?)")
                      .bind(emp.id, date, Number(hrs))
                  );
                }
              }
            }

            if (Array.isArray(emp.advances)) {
              for (const adv of emp.advances) {
                statements.push(
                  env.DB.prepare("INSERT INTO advances (id, employee_id, date, amount, notes) VALUES (?, ?, ?, ?, ?)")
                    .bind(adv.id, emp.id, adv.date, Number(adv.amount), adv.notes || "")
                );
              }
            }
          }

          // Execute batch operations atomically inside a D1 transaction
          await env.DB.batch(statements);

          return new Response(JSON.stringify({ success: true }), {
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

    // fallback to a 404 response for other paths
    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders
    });
  }
};
