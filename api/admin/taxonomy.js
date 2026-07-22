// /api/admin/taxonomy[?fn=<name>]  (admin only)
//
// Single dispatcher for the taxonomy workbench's serverless endpoints. Each of
// the underlying handlers used to be its own Vercel function (taxonomy.js +
// taxonomy-*.js); to stay under Vercel's 100-function-per-deployment limit they
// were renamed with a leading underscore (so Vercel no longer counts them as
// routes, but they're still importable) and are now fanned out from here.
//
// Routing key is `fn`, NOT `action`: the snapshots handler already reads
// req.query.action ('restore') and req.query.diff/full, and the CRUD + prompt-
// versions handlers read req.query.id — using `fn` keeps the dispatcher from
// clobbering those, so e.g. /api/admin/taxonomy?fn=snapshots&action=restore&id=12
// works. With no `fn` (the bare /api/admin/taxonomy CRUD URLs, unchanged), we
// fall through to the row-CRUD handler, which does its own GET/POST/PUT/DELETE.
//
// Each handler self-gates with requireAdmin and reads its own req.query/body, so
// this dispatcher stays thin: it forwards (req, res) unchanged and never reads
// the body. The CSV handler sets its own text/csv + Content-Disposition headers,
// so a GET to ?fn=export-csv still downloads correctly.
import crud from './_taxonomy-crud.js';
import audit from './_taxonomy-audit.js';
import bulk from './_taxonomy-bulk.js';
import bulkop from './_taxonomy-bulkop.js';
import exportCsv from './_taxonomy-export-csv.js';
import importBoard from './_taxonomy-import-board.js';
import importCsv from './_taxonomy-import-csv.js';
import promptVersions from './_taxonomy-prompt-versions.js';
import snapshots from './_taxonomy-snapshots.js';

// Modest bump over the platform default for the row-iterating ops
// (bulk / import-board / snapshots). The original handlers had no config.
// 300s: the CSV merge's enrich pass runs one UPDATE per matched row — a
// full master overlay (~1,300 rows) needs the headroom.
export const config = { maxDuration: 300 };

const HANDLERS = {
  'audit': audit,
  'bulk': bulk,
  'bulkop': bulkop,
  'export-csv': exportCsv,
  'import-board': importBoard,
  'import-csv': importCsv,
  'prompt-versions': promptVersions,
  'snapshots': snapshots,
};

export default async function handler(req, res) {
  const fn = String((req.query && req.query.fn) || '');
  // No fn (or the explicit crud aliases) → the GET/POST/PUT/DELETE row CRUD.
  if (!fn || fn === 'taxonomy' || fn === 'crud') return crud(req, res);
  const dispatch = HANDLERS[fn];
  if (!dispatch) {
    res.status(404).json({ error: 'unknown taxonomy fn', fn, fns: ['crud', ...Object.keys(HANDLERS)] });
    return;
  }
  return dispatch(req, res);
}
