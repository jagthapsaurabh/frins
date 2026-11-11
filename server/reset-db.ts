#!/usr/bin/env node
/**
 * Wipe the local database and re-seed it.
 *
 *   npm run db:reset            # asks for confirmation
 *   npm run db:reset -- --yes   # no prompt, for scripts
 *
 * This deletes data/frins.db plus its WAL sidecar files, then lets the normal
 * bootstrap in server/db.ts recreate the schema and seed data. Every user,
 * lead, booking, course and upload in that file is gone. Back up first if the
 * database holds anything you care about.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import process from 'node:process';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const FILES = ['frins.db', 'frins.db-wal', 'frins.db-shm'];

async function confirm(): Promise<boolean> {
  if (process.argv.includes('--yes') || process.argv.includes('-y')) return true;
  if (!process.stdin.isTTY) {
    console.error('Refusing to run without confirmation. Re-run with --yes.');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `This deletes ${path.join(DATA_DIR, 'frins.db')} and all its data. Type "reset" to continue: `
    );
    return answer.trim().toLowerCase() === 'reset';
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  if (!(await confirm())) {
    console.log('Cancelled. Nothing was deleted.');
    return;
  }

  for (const file of FILES) {
    const target = path.join(DATA_DIR, file);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      console.log(`removed ${file}`);
    }
  }

  // Import after the files are gone so the module opens a fresh database,
  // then seed it exactly as a first boot would.
  const { initDatabaseAndSeed } = await import('./db.js');
  initDatabaseAndSeed();

  console.log('');
  console.log('Database reset and seeded.');
  console.log('Seeded accounts all use the password frins123:');
  console.log('  admin@frins.org          ADMIN');
  console.log('  vikram.guide@frins.org   GUIDE');
  console.log('  aarav@example.com        LEARNER');
  console.log('  priya@example.com        LEARNER');
  console.log('  rohan@example.com        LEARNER');
  console.log('');
  console.log('Create your own admin before going live:');
  console.log('  npm run create:admin -- --email you@frins.in --name "Your Name" --role ADMIN');
}

main().catch((error) => {
  console.error(`Failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
