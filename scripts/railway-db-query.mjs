import Database from "better-sqlite3";

const dbPath = process.env.DB_PATH || "/app/data/app.db";
const query = process.argv[2] || "users";

const db = new Database(dbPath, { readonly: true });

function print(rows) {
  console.log(JSON.stringify(rows, null, 2));
}

function availabilityForDate(ymd) {
  const prefix = `${ymd}T`;
  const rows = db
    .prepare(
      `SELECT a.run_id, r.title AS run_title, a.user_id, u.first_name, u.last_name, a.slots_json
       FROM availability a
       JOIN runs r ON r.id = a.run_id
       JOIN users u ON u.id = a.user_id
       WHERE r.date_start <= ? AND r.date_end >= ?
       ORDER BY a.run_id, a.user_id`
    )
    .all(ymd, ymd);

  return {
    date: ymd,
    runs: db
      .prepare(
        `SELECT id, title, date_start, date_end, run_code
         FROM runs WHERE date_start <= ? AND date_end >= ?
         ORDER BY id`
      )
      .all(ymd, ymd),
    availability: rows
      .map((row) => {
        let slots = [];
        try {
          slots = JSON.parse(row.slots_json || "[]");
        } catch {
          slots = [];
        }
        const daySlots = slots.filter((s) => String(s).startsWith(prefix));
        if (!daySlots.length) return null;
        return {
          run_id: row.run_id,
          run_title: row.run_title,
          user_id: row.user_id,
          name: `${row.first_name} ${row.last_name}`,
          slots: daySlots,
        };
      })
      .filter(Boolean),
  };
}

switch (query) {
  case "users":
    print(
      db
        .prepare(
          "SELECT id, first_name, last_name, email, created_at FROM users ORDER BY id"
        )
        .all()
    );
    break;
  case "runs":
    print(
      db
        .prepare(
          `SELECT id, title, capacity, date_start, date_end, run_code, share_token, is_default, created_at
           FROM runs ORDER BY id`
        )
        .all()
    );
    break;
  case "members":
    print(
      db
        .prepare(
          `SELECT rm.run_id, r.title AS run_title, rm.user_id, u.first_name, u.last_name, u.email, rm.joined_at
           FROM run_members rm
           JOIN runs r ON r.id = rm.run_id
           JOIN users u ON u.id = rm.user_id
           ORDER BY rm.run_id, rm.user_id`
        )
        .all()
    );
    break;
  case "availability":
    print(
      db
        .prepare(
          `SELECT a.run_id, r.title AS run_title, a.user_id, u.first_name, u.last_name,
                  a.slots_json, a.updated_at, a.first_saved_at
           FROM availability a
           JOIN runs r ON r.id = a.run_id
           JOIN users u ON u.id = a.user_id
           ORDER BY a.run_id, a.user_id`
        )
        .all()
        .map(({ slots_json, ...row }) => ({
          ...row,
          slots: JSON.parse(slots_json || "[]"),
        }))
    );
    break;
  case "june13":
    print(availabilityForDate("2026-06-13"));
    break;
  default:
    if (/^\d{4}-\d{2}-\d{2}$/.test(query)) {
      print(availabilityForDate(query));
      break;
    }
    console.error(`Unknown query: ${query}`);
    console.error(
      "Usage: node scripts/railway-db-query.mjs [users|runs|members|availability|june13|YYYY-MM-DD]"
    );
    process.exit(1);
}

db.close();
