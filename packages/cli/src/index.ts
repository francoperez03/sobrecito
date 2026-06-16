#!/usr/bin/env node
/**
 * sobre — the employer-facing CLI for confidential payroll on Stellar/Soroban.
 *
 * This is the runnable shell (Plan 06-01). The full CSV → proof-gen → blobs →
 * pool.transact pipeline lands in Plan 06-02; here the `pay` command is a stub
 * that echoes what it would do so `sobre pay --help` and a dry-run both work.
 */
import { Command } from "commander";

const program = new Command();

program
  .name("sobre")
  .description("Confidential payroll on Stellar: pay salaries, seal amounts, prove the total.")
  .version("0.1.0");

program
  .command("pay")
  .description("Submit a payroll batch from a CSV (name,amount,public_key).")
  .argument("<file>", "path to the payroll CSV")
  .option("--dry-run", "print what would be submitted without transacting")
  .option("--verbose", "print the honest-disclosure note and extra detail")
  .action((file: string, opts: { dryRun?: boolean; verbose?: boolean }) => {
    const prefix = opts.dryRun ? "[dry-run] " : "";

    if (opts.verbose) {
      console.log(
        `${prefix}PoC — not audited. ZK proof is technical; confidentiality is a policy guarantee.`,
      );
    }

    // UI-SPEC start line: `sobre pay: reading nomina.csv`
    console.log(`${prefix}sobre pay: reading ${file}`);

    // The proof-gen → blobs → pool.transact pipeline lands in Plan 06-02.
    console.log(`${prefix}· pipeline not yet wired (Plan 06-02 fills proof-gen → submit)`);
  });

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
