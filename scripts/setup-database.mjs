#!/usr/bin/env node

/**
 * Database Setup Script
 *
 * Applies all SQL migrations to your Supabase database using the Management API.
 *
 * Usage:
 *   node scripts/setup-database.mjs
 *
 * Requires:
 *   - NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *   - SUPABASE_ACCESS_TOKEN env var (or set in .mcp.json)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

// Load env from .env.local
const envPath = resolve(rootDir, '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// Extract project ref from URL (e.g., "hwjnymwzibpfylmkccox" from "https://hwjnymwzibpfylmkccox.supabase.co")
const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0];

// Try to get access token from env or .mcp.json
let accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!accessToken) {
  try {
    const mcpConfig = JSON.parse(readFileSync(resolve(rootDir, '.mcp.json'), 'utf-8'));
    accessToken = mcpConfig.mcpServers?.supabase?.env?.SUPABASE_ACCESS_TOKEN;
  } catch {
    // ignore
  }
}

const migrations = [
  'supabase/migrations/001_initial_schema.sql',
  'supabase/migrations/002_seed_data.sql',
  'supabase/migrations/003_increment_lead_count_function.sql',
  'supabase/migrations/004_per_agent_scoring_priority.sql',
  'supabase/migrations/005_price_ranges_and_cleanup.sql',
  'supabase/migrations/006_scoring_simplification.sql',
  'supabase/migrations/007_daily_load_and_weights_cleanup.sql',
];

async function runMigrationViaManagementAPI(sql, label) {
  if (!accessToken) return null;

  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Migration "${label}" failed (${res.status}): ${text}`);
  }

  return res.json();
}

async function main() {
  console.log('Life at Lakewood - Database Setup');
  console.log(`Project: ${projectRef}`);
  console.log('');

  if (accessToken) {
    console.log('Found Supabase access token - applying migrations via Management API...');
    console.log('');

    for (const migrationPath of migrations) {
      const filePath = resolve(rootDir, migrationPath);
      const sql = readFileSync(filePath, 'utf-8');
      const label = migrationPath.split('/').pop();

      try {
        await runMigrationViaManagementAPI(sql, label);
        console.log(`  Applied: ${label}`);
      } catch (err) {
        console.error(`  FAILED: ${label}`);
        console.error(`    ${err.message}`);
        console.log('');
        console.log('If the error says tables already exist, the database is already set up.');
        process.exit(1);
      }
    }

    console.log('');
    console.log('Database setup complete!');
    console.log('  - 7 tables created');
    console.log('  - 3 locations seeded (Lakewood, Wellen Park, Parrish)');
    console.log('  - Default scoring weights configured (25/20/20/15/10/10)');
    console.log('  - Helper functions and indexes installed');
  } else {
    console.log('No SUPABASE_ACCESS_TOKEN found.');
    console.log('');
    console.log('Option 1: Set the token and re-run:');
    console.log('  SUPABASE_ACCESS_TOKEN=your_token node scripts/setup-database.mjs');
    console.log('');
    console.log('Option 2: Copy the SQL below into the Supabase SQL Editor:');
    console.log('  https://supabase.com/dashboard/project/' + projectRef + '/sql/new');
    console.log('');
    console.log('='.repeat(60));

    for (const migrationPath of migrations) {
      const filePath = resolve(rootDir, migrationPath);
      const sql = readFileSync(filePath, 'utf-8');
      console.log(`-- Migration: ${migrationPath.split('/').pop()}`);
      console.log(sql);
      console.log('');
    }

    console.log('='.repeat(60));
  }
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
