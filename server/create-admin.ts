#!/usr/bin/env node
/**
 * Create a staff account (ADMIN, CURRICULUM_OWNER, GUIDE) or a learner.
 *
 * Run it from the project root so it opens the same database as the app:
 *
 *   npm run create:admin -- --email you@frins.in --name "Your Name"
 *   npm run create:admin -- --email you@frins.in --name "Your Name" --role ADMIN --password 'LongPassword123'
 *   npm run create:admin -- --list
 *
 * If you do not pass --password, a strong one is generated and printed once.
 * If the email already exists, the account is left alone unless you pass --force,
 * which resets the password, role and status.
 */
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import process from 'node:process';
import { db, hashPassword, initDatabaseAndSeed, writeAuditEvent } from './db.js';

const ROLES = ['ADMIN', 'CURRICULUM_OWNER', 'GUIDE', 'LEARNER'] as const;
type Role = (typeof ROLES)[number];

const HELP = `
FRINS account tool

Usage
  npm run create:admin -- [options]

Options
  --email <address>     Email to sign in with (required unless --list)
  --name <full name>    Display name (required)
  --role <ROLE>         ADMIN | CURRICULUM_OWNER | GUIDE | LEARNER   (default: ADMIN)
  --password <value>    Password. Omit to have one generated and printed once.
  --force               If the email exists, reset its password, role and status
  --list                List existing accounts and exit
  --help                Show this text

Examples
  npm run create:admin -- --email sau@frins.in --name "Saurabh" --role ADMIN
  npm run create:admin -- --email head@frins.in --name "Head of Curriculum" --role CURRICULUM_OWNER
  npm run create:admin -- --email mentor@frins.in --name "Mentor" --role GUIDE
  npm run create:admin -- --email sau@frins.in --name "Saurabh" --force   # reset the password

Notes
  - Run it on the server as the app user: sudo -u frins npm run create:admin -- ...
  - It writes to <project>/data/frins.db, the same file the app uses.
  - Passwords are stored as scrypt hashes. The plain text is never logged.
`.trim();

interface Args {
  email?: string;
  name?: string;
  role?: string;
  password?: string;
  force: boolean;
  list: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { force: false, list: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const eq = token.indexOf('=');
    const key = eq > -1 ? token.slice(0, eq) : token;
    const inlineValue = eq > -1 ? token.slice(eq + 1) : undefined;
    const nextValue = () => inlineValue ?? argv[++i];

    switch (key) {
      case '--email':
        args.email = nextValue();
        break;
      case '--name':
        args.name = nextValue();
        break;
      case '--role':
        args.role = nextValue();
        break;
      case '--password':
        args.password = nextValue();
        break;
      case '--force':
        args.force = true;
        break;
      case '--list':
        args.list = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (token.startsWith('-')) {
          throw new Error(`Unknown option: ${token}`);
        }
    }
  }
  return args;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(20);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return `${out.slice(0, 6)}-${out.slice(6, 12)}-${out.slice(12, 18)}`;
}

function describeDb(): string {
  return `${process.cwd()}/data/frins.db`;
}

function listAccounts(): void {
  const rows = db
    .prepare(
      `SELECT id, name, email, role, account_status, created_at
         FROM users
        ORDER BY CASE role WHEN 'ADMIN' THEN 0 WHEN 'CURRICULUM_OWNER' THEN 1 WHEN 'GUIDE' THEN 2 ELSE 3 END,
                 created_at ASC`
    )
    .all() as Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    account_status: string;
    created_at: string;
  }>;

  if (rows.length === 0) {
    console.log('No accounts yet.');
    return;
  }

  console.log(`Database: ${describeDb()}`);
  console.log('');
  console.log('ROLE'.padEnd(17) + 'STATUS'.padEnd(10) + 'EMAIL'.padEnd(30) + 'NAME');
  console.log('-'.repeat(85));
  for (const row of rows) {
    console.log(
      row.role.padEnd(17) + row.account_status.padEnd(10) + row.email.padEnd(30) + row.name
    );
  }
  console.log('');
  console.log(`${rows.length} account(s).`);
}

async function ask(question: string, fallback = ''): Promise<string> {
  if (!process.stdin.isTTY) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`\n  ${(error as Error).message}\n`);
    console.error(HELP);
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    console.log(HELP);
    return;
  }

  initDatabaseAndSeed();

  if (args.list) {
    listAccounts();
    return;
  }

  console.log('');
  console.log('  FRINS account setup');
  console.log(`  Database: ${describeDb()}`);
  console.log('');

  const email = (args.email || (await ask('Email: '))).trim().toLowerCase();
  if (!email) {
    console.error('  Email is required. Pass --email or run in a terminal to be prompted.');
    process.exitCode = 1;
    return;
  }
  if (!EMAIL_RE.test(email)) {
    console.error(`  "${email}" is not a valid email address.`);
    process.exitCode = 1;
    return;
  }

  const name = (args.name || (await ask('Full name: '))).trim();
  if (name.length < 2) {
    console.error('  A display name of at least 2 characters is required. Pass --name.');
    process.exitCode = 1;
    return;
  }

  const rawRole = (args.role || (await ask(`Role [${ROLES.join('/')}] (default ADMIN): `)) || 'ADMIN')
    .trim()
    .toUpperCase();
  if (!ROLES.includes(rawRole as Role)) {
    console.error(`  "${rawRole}" is not a role. Choose one of: ${ROLES.join(', ')}.`);
    process.exitCode = 1;
    return;
  }
  const role = rawRole as Role;

  const suppliedPassword = args.password || process.env.FRINS_ADMIN_PASSWORD || '';
  const generated = suppliedPassword.length === 0;
  const password = generated ? generatePassword() : suppliedPassword;

  if (password.length < 8) {
    console.error('  Password must be at least 8 characters.');
    process.exitCode = 1;
    return;
  }
  if (!generated && ['frins123', 'password', 'admin', 'changeme'].includes(password.toLowerCase())) {
    console.warn('  Warning: that password is on the obvious list. Change it after signing in.');
  }

  const existing = db
    .prepare('SELECT id, role, email FROM users WHERE lower(email) = ?')
    .get(email) as { id: string; role: string; email: string } | undefined;

  const now = new Date().toISOString();

  if (existing && !args.force) {
    console.error('');
    console.error(`  ${email} already exists (${existing.role}).`);
    console.error('  Nothing was changed.');
    console.error('');
    console.error('  To reset that account:');
    console.error(`    npm run create:admin -- --email ${email} --name "${name}" --role ${role} --force`);
    process.exitCode = 1;
    return;
  }

  if (existing) {
    db.prepare(
      `UPDATE users
          SET name = ?, password_hash = ?, role = ?, account_status = 'ACTIVE', updated_at = ?
        WHERE id = ?`
    ).run(name, hashPassword(password), role, now, existing.id);

    writeAuditEvent({
      actorUserId: null,
      actorRole: 'SYSTEM_CLI',
      action: 'STAFF_ACCOUNT_RESET',
      entityType: 'USER',
      entityId: existing.id,
      details: { email, role, via: 'create-admin-cli' }
    });

    console.log('  Account updated.');
    console.log(`    Email:  ${email}`);
    console.log(`    Role:   ${role}`);
    console.log(`    Status: ACTIVE`);
    if (generated) {
      console.log('');
      console.log('  Temporary password (shown once, copy it now):');
      console.log(`    ${password}`);
    }
    console.log('');
    return;
  }

  const id = `usr_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const assignedGuide =
    role === 'LEARNER'
      ? ((db.prepare("SELECT id FROM users WHERE role = 'GUIDE' ORDER BY created_at ASC LIMIT 1").get() as
          | { id: string }
          | undefined)?.id ?? null)
      : null;

  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, account_status, track, assigned_guide_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`
  ).run(id, name, email, hashPassword(password), role, 'trader', assignedGuide, now, now);

  writeAuditEvent({
    actorUserId: null,
    actorRole: 'SYSTEM_CLI',
    action: 'STAFF_ACCOUNT_CREATED',
    entityType: 'USER',
    entityId: id,
    details: { email, role, via: 'create-admin-cli' }
  });

  console.log('  Account created.');
  console.log(`    Name:   ${name}`);
  console.log(`    Email:  ${email}`);
  console.log(`    Role:   ${role}`);
  console.log(`    ID:     ${id}`);
  if (generated) {
    console.log('');
    console.log('  Temporary password (shown once, copy it now):');
    console.log(`    ${password}`);
    console.log('');
    console.log('  Sign in at /admin/login for staff roles, or /login for a learner.');
  } else {
    console.log('');
    console.log(`  Sign in at ${role === 'LEARNER' ? '/login' : '/admin/login'} with the password you supplied.`);
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error(`\n  Failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      db.close();
    } catch {
      /* nothing to close */
    }
  });
