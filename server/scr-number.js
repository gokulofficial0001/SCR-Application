const SCR_SERIES_START = 147;

function allocateSCRNumber(db) {
  let maxExisting = SCR_SERIES_START - 1;
  const rows = db.prepare('SELECT data FROM scr_requests').all();

  for (const row of rows) {
    const scr = JSON.parse(row.data);
    const raw = scr && scr.scrNumber != null ? String(scr.scrNumber).trim() : '';
    if (!/^\d+$/.test(raw)) continue;

    const number = Number(raw);
    if (!Number.isSafeInteger(number)) {
      throw new Error(`SCR number is outside the safe integer range: ${raw}`);
    }
    if (number > maxExisting) maxExisting = number;
  }

  const sequence = db.prepare(
    'SELECT last_number FROM scr_number_sequence WHERE id = 1'
  ).get();
  const lastNumber = sequence ? Number(sequence.last_number) : SCR_SERIES_START - 1;
  if (!Number.isSafeInteger(lastNumber)) {
    throw new Error('Stored SCR number sequence is invalid');
  }

  const nextNumber = Math.max(maxExisting, lastNumber) + 1;
  if (!Number.isSafeInteger(nextNumber)) {
    throw new Error('SCR number sequence is outside the safe integer range');
  }

  db.prepare(
    'INSERT OR REPLACE INTO scr_number_sequence (id, last_number) VALUES (1, ?)'
  ).run(nextNumber);

  return String(nextNumber);
}

module.exports = { allocateSCRNumber };
