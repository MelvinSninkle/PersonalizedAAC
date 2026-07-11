// /api/admin/lab?action=<name>  (admin only)
//
// Single dispatcher for the Lab's serverless endpoints. The 11 underlying
// handlers were each their own Vercel function (api/admin/lab-*.js); to stay
// under Vercel's 100-function-per-deployment limit they were renamed with a
// leading underscore (so Vercel no longer counts them as routes, but they're
// still importable) and are now fanned out from here by the `action` query.
//
// Each handler self-gates with requireAdmin and reads its own req.query/body,
// so this dispatcher stays thin: it just forwards (req, res) unchanged. The
// raw-body upload handlers still work — the runtime leaves image/* streams
// readable, and we only touch req.query here, never the body.
//
// maxDuration is the max any dispatched action needs (the generate paths),
// since this file's config governs all of them now.
import batchGenerate from './_lab-batch-generate.js';
import boardState from './_lab-board-state.js';
import buildBoard from './_lab-build-board.js';
import categories from './_lab-categories.js';
import categoryGenerate from './_lab-category-generate.js';
import categoryUpload from './_lab-category-upload.js';
import defaultsView from './_lab-defaults-view.js';
import generateScene from './_lab-generate-scene.js';
import generate from './_lab-generate.js';
import indexObjects from './_lab-index-objects.js';
import portImage from './_lab-port-image.js';
import publishDefault from './_lab-publish-default.js';
import publishTile from './_lab-publish-tile.js';
import seedDefaults from './_lab-seed-defaults.js';
import seedStatusAction from './_lab-seed-status.js';
import onboardingReport from './_lab-onboarding-report.js';
import settings from './_lab-settings.js';
import uploadImage from './_lab-upload-image.js';
import tileLab from './_lab-tile-lab.js';
import styleDefaults from './_lab-style-defaults.js';
import layout from './_lab-layout.js';
import voices from './_lab-voices.js';
import publish from './_lab-publish.js';
import boards from './_lab-boards.js';
import reports from './_lab-reports.js';
import translations from './_lab-translations.js';

export const config = { maxDuration: 300 };

const HANDLERS = {
  'generate': generate,
  'generate-scene': generateScene,
  'batch-generate': batchGenerate,
  'category-generate': categoryGenerate,
  'category-upload': categoryUpload,
  'categories': categories,
  'board-state': boardState,
  'build-board': buildBoard,
  'port-image': portImage,
  'publish-tile': publishTile,
  'publish-default': publishDefault,
  'defaults-view': defaultsView,
  'index-objects': indexObjects,
  'seed-defaults': seedDefaults,
  'seed-status': seedStatusAction,
  'onboarding-report': onboardingReport,
  'settings': settings,
  'tile-lab': tileLab,
  'upload-image': uploadImage,
  'style-defaults': styleDefaults,
  'layout': layout,
  'voices': voices,
  'publish': publish,
  'boards': boards,
  'reports': reports,
  'translations': translations,
};

export default async function handler(req, res) {
  const action = String((req.query && req.query.action) || '');
  const fn = HANDLERS[action];
  if (!fn) {
    res.status(404).json({ error: 'unknown lab action', action, actions: Object.keys(HANDLERS) });
    return;
  }
  return fn(req, res);
}
