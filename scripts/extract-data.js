const fs = require('fs');
const html = fs.readFileSync(
  'C:/Users/jojae/AppData/Roaming/Claude/scratch-workspaces/52ac3837-bc05-4f25-9f48-dd9b8b7d406e/e361c284-38bb-4b01-bb89-69640d4b22fe/scratch-2026-09-04-e730b9/moveout-checklist.html',
  'utf8'
);

function extractArray(marker) {
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error('marker not found: ' + marker);
  const arrStart = startIdx + marker.length;
  let depth = 0, i = arrStart, inStr = false, esc = false;
  for (; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (ch === '\\') { esc = true; }
      else if (ch === '"') { inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  var src = html.slice(arrStart, i);
  // SECTIONS is a JS object literal (unquoted keys, single-quoted strings), not valid
  // JSON — UNIT_HISTORY happens to already be strict JSON. Evaluate as JS either way
  // (trusted local file, not untrusted input) so both shapes work through one path.
  return new Function('return (' + src + ')')();
}

const sections = extractArray('var SECTIONS = ');
const unitHistoryRaw = extractArray('var UNIT_HISTORY = ');
console.log('sections:', sections.length, 'unitHistory:', unitHistoryRaw.length);

fs.writeFileSync(__dirname + '/../lib/sections.json', JSON.stringify(sections, null, 2));

// UNIT_HISTORY was [b, u, [[label, amount], ...]] triples style in some spots and
// {b,u,e:[...]} grouped style in others depending on which session touched it last —
// normalize everything to the {building, unit, entries} shape the new unit_history
// table expects, so the importer doesn't care which shape a given record was in.
const normalized = unitHistoryRaw.map(function (rec) {
  if (Array.isArray(rec)) {
    // legacy triple: [id, type, items] — this shape doesn't carry building/unit
    // directly, skip (none should remain post-refactor, but don't crash the extract).
    return null;
  }
  return { building: rec.b, unit: rec.u, entries: rec.e || [] };
}).filter(Boolean);
fs.writeFileSync(__dirname + '/../lib/unitHistory.json', JSON.stringify(normalized));
console.log('normalized unitHistory records:', normalized.length);
