#!/usr/bin/env tsx
/**
 * Retire the demo accounts that ship with a fresh development database.
 *
 * A production install should have exactly one real admin, created with
 * `npm run create:admin`. The five sample accounts all share a known password,
 * so they must not stay on a public server.
 *
 *   npm run purge:demo              list what would be retired, change nothing
 *   npm run purge:demo -- --yes     actually retire them
 *
 * Retiring means: the account is suspended, its password is replaced with an
 * unguessable random value, and every session is deleted. The row stays so
 * historical tasks, messages and audit entries keep a valid owner.
 *
 * Accounts are matched by email AND role, and only the five seeded addresses
 * are ever touched. The script refuses to run if retiring them would leave the
 * database with no active administrator.
 */

import crypto from 'node:crypto';
import { db, hashPassword, initDatabaseAndSeed } from './db.js';

const DEMO_ACCOUNTS: Array<{ email: string; role: string }> = [
  { email: 'admin@frins.org', role: 'ADMIN' },
  { email: 'vikram.guide@frins.org', role: 'GUIDE' },
  { email: 'aarav@example.com', role: 'LEARNER' },
  { email: 'priya@example.com', role: 'LEARNER' },
  { email: 'rohan@example.com', role: 'LEARNER' }
];

const confirmed = process.argv.includes('--yes');

initDatabaseAndSeed();

const found = DEMO_ACCOUNTS.map((account) => {
  const user = db
    .prepare('SELECT id, name, email, role FROM users WHERE lower(email) = ? AND role = ?')
    .get(account.email, account.role) as
    | { id: string; name: string; email: string; role: string }
    | undefined;
  return { ...account, user };
}).filter((entry) => entry.user);

if (found.length === 0) {
  console.log('No demo accounts found. Nothing to do.');
  process.exit(0);
}

console.log('\nDemo accounts found:\n');
for (const entry of found) {
  console.log(`  ${entry.user!.role.padEnd(9)} ${entry.user!.email.padEnd(28)} ${entry.user!.name}`);
}

const remainingAdmins = (
  db
    .prepare(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND account_status = 'ACTIVE' AND lower(email) != 'admin@frins.org'"
    )
    .get() as { count: number }
).count;

console.log('');
if (remainingAdmins === 0) {
  console.log('Refusing to continue: this would leave no active administrator.');
  console.log('Create a real one first:');
  console.log('  npm run create:admin -- --email you@frins.in --name "Your Name" --role ADMIN');
  console.log('');
  process.exit(1);
}

if (!confirmed) {
  console.log('Dry run. Nothing was changed.');
  console.log(`Run again with --yes to suspend these ${found.length} accounts, reset their passwords and end their sessions.`);
  console.log(`Active administrators that will remain: ${remainingAdmins}`);
  console.log('');
  process.exit(0);
}

const retire = db.transaction(() => {
  for (const entry of found) {
    const id = entry.user!.id;
    // A random password nobody knows. Even a future reactivation cannot
    // restore the published demo password.
    const scrambled = hashPassword(`retired_${crypto.randomBytes(32).toString('hex')}`);
    db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(id);
    db.prepare(
      "UPDATE users SET account_status = 'SUSPENDED', password_hash = ?, updated_at = ? WHERE id = ?"
    ).run(scrambled, new Date().toISOString(), id);
  }
});

try {
  retire();
  console.log(`Retired ${found.length} demo accounts.`);
  console.log('They are suspended, their passwords are reset and their sessions are gone.');
  console.log('Historical tasks and audit entries still point at valid users.');
  console.log('Sign in with the admin account you created.');
  console.log('');
} catch (error: any) {
  console.error('Retiring them failed:', error.message);
  console.error('Nothing else was changed. Check the error and run again.');
  process.exit(1);
}
