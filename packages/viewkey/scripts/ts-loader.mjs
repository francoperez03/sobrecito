/**
 * ts-loader.mjs — Node ESM resolve hook so the runnable scripts under this dir
 * can import the viewkey TypeScript source directly (which uses NodeNext `.js`
 * specifiers) without a separate build step. Maps a relative `*.js` specifier to
 * its sibling `*.ts` when the `.ts` exists, then lets Node's native type stripping
 * (Node >= 22.6, `--experimental-strip-types`) run on the source.
 *
 * Usage:
 *   node --import ./packages/viewkey/scripts/register.mjs <script.ts>
 */
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    specifier.endsWith(".js") &&
    context.parentURL
  ) {
    const parentPath = fileURLToPath(context.parentURL);
    const candidate = resolvePath(
      dirname(parentPath),
      specifier.replace(/\.js$/, ".ts"),
    );
    if (existsSync(candidate)) {
      return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  return nextResolve(specifier, context);
}
