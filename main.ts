// Token Radar — entrypoint.
//
// Reads the sealed snapshot, scores every pre-token protocol the house's
// own rule leaves in, and writes the output bundle:
//
//   board.json       the ranked board (rows with farm plans)
//   data.js          the same rows for the dashboard (farm plans are
//                    generated in the page, from the same model)
//   dashboard/       the dashboard, copied from the repo
//   screenshots/     the three screenshots, copied from the repo
//   dossier.json     the house dossier, built with the vendor library
//
// Run with no arguments: node main.ts
//   --input <dir>    snapshot directory (default /input)
//   --output <dir>   output directory (default MAKEFUN_OUTPUT_DIR or /output)
//
// The run is deterministic: the same snapshot bytes produce the same
// output bytes, with no clock, no network and no randomness anywhere in
// the path.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { boardIssues, boardJson, buildBoard, dataScript, readSnapshot } from './lib/model.ts';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv: string[]): { input: string; output: string } {
  const args = { input: '/input', output: process.env.MAKEFUN_OUTPUT_DIR ?? '/output' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' && argv[i + 1]) args.input = argv[++i];
    else if (a === '--output' && argv[i + 1]) args.output = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

function main(): void {
  const { input, output } = parseArgs(process.argv);
  const snapshot = readSnapshot(input);
  const { rows, live, setAside } = buildBoard(snapshot);
  const issues = boardIssues(snapshot, rows);
  if (issues.length > 0) {
    throw new Error(`board issues: ${issues.join('; ')}`);
  }

  const dashboardDir = join(REPO, 'dashboard');
  const screenshotsDir = join(REPO, 'screenshots');
  if (!existsSync(dashboardDir)) throw new Error(`missing dashboard directory: ${dashboardDir}`);
  if (!existsSync(screenshotsDir)) throw new Error(`missing screenshots directory: ${screenshotsDir}`);

  const boardPath = join(output, 'board.json');
  const dataPath = join(output, 'data.js');
  const dashboardOut = join(output, 'dashboard');
  const screenshotsOut = join(output, 'screenshots');

  rmSync(boardPath, { force: true });
  rmSync(dataPath, { force: true });
  rmSync(dashboardOut, { recursive: true, force: true });
  rmSync(screenshotsOut, { recursive: true, force: true });
  rmSync(join(output, 'dossier.json'), { force: true });
  mkdirSync(output, { recursive: true });

  writeFileSync(boardPath, boardJson(rows), 'utf8');
  writeFileSync(dataPath, dataScript(snapshot, rows, live, setAside), 'utf8');
  cpSync(dashboardDir, dashboardOut, { recursive: true });
  cpSync(screenshotsDir, screenshotsOut, { recursive: true });

  const dossier = buildDossier(output, { text_max_bytes: 65536 });
  writeFileSync(join(output, 'dossier.json'), dossier);

  const watchlistCovered = snapshot.watchlist.filter((slug) => rows.some((r) => r.slug === slug)).length;
  const top = rows[0];
  const last = rows[rows.length - 1];
  console.log(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${rows.length} rows scored (${rows.length - snapshot.watchlist.length} early, ${live.length} live set aside)\n` +
      `watchlist covered ${watchlistCovered}/${snapshot.watchlist.length}; ` +
      `top: ${top.name} (${top.slug}) ${top.implied_value_usd.toLocaleString('en-US')} USD; ` +
      `last: ${last.name} (${last.slug}) ${last.implied_value_usd.toLocaleString('en-US')} USD\n` +
      `wrote ${boardPath}, ${dataPath}, ${dashboardOut}, ${screenshotsOut}, dossier.json`,
  );
}

main();
