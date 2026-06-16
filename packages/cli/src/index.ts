#!/usr/bin/env node
/**
 * sobre — the employer-facing CLI for confidential payroll on Stellar/Soroban.
 *
 * `sobre pay nomina.csv` runs the full pipeline in one command (Plan 06-02):
 * parse + validate the CSV → freeze the dual ECIES blobs once → compute the
 * matching ext_data_hash + generate a fresh proof → submit one batch to the live
 * pool. `--dry-run` plans without transacting; `--verbose` prints the honest
 * disclosure on start.
 */
import { Command } from "commander";
import { payCommand } from "./commands/pay.js";
import { errorLine } from "./output.js";

const program = new Command();

program
  .name("sobre")
  .description("Confidential payroll on Stellar: pay salaries, seal amounts, prove the total.")
  .version("0.1.0");

program
  .command("pay")
  .description("Submit a payroll batch from a CSV (name,amount,public_key).")
  .argument("<file>", "path to the payroll CSV")
  .option("--dry-run", "print the planned batch without transacting")
  .option("--verbose", "print the honest-disclosure note and extra detail")
  .option("--network <network>", "stellar network", "testnet")
  .action((file: string, opts: { dryRun?: boolean; verbose?: boolean; network?: string }) => {
    payCommand(file, opts);
  });

async function main(): Promise<void> {
  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(errorLine(message, "check input and retry"));
  process.exit(1);
});
