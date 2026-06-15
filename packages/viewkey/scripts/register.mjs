/**
 * register.mjs — registers the ts-loader resolve hook for running the viewkey
 * scripts directly from TypeScript source. See ts-loader.mjs.
 *
 * Usage:
 *   node --import ./packages/viewkey/scripts/register.mjs <script.ts>
 */
import { register } from "node:module";

register("./ts-loader.mjs", import.meta.url);
