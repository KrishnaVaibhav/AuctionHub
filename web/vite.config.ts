import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Index just past the bracket that closes the one at `start` (skips strings and comments). */
function closingBracket(code: string, start: number): number {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < code.length && code[i] !== c; i++) if (code[i] === "\\") i++;
    } else if (c === "/" && code[i + 1] === "*") {
      i = code.indexOf("*/", i + 2) + 1;
    } else if (c === "[" || c === "(" || c === "{") {
      depth++;
    } else if (c === "]" || c === ")" || c === "}") {
      if (--depth === 0) return i + 1;
    }
  }
  return -1;
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.tsx?$/.test(entry.name)) yield path;
  }
}

/**
 * Phosphor ships every icon in six weights and the app draws four (regular,
 * bold, fill, duotone), so the build drops "thin" and "light" from each
 * icon's weight map: about a third of the icon code, most of it in the first
 * download. The build stops if the app starts using a dropped weight.
 */
function phosphorWeights(drop = ["thin", "light"]): Plugin {
  return {
    name: "phosphor-weights",
    apply: "build",
    enforce: "pre",
    buildStart() {
      for (const file of sourceFiles(fileURLToPath(new URL("./src", import.meta.url)))) {
        const text = readFileSync(file, "utf8");
        for (const w of drop) {
          const used = new RegExp(`weight=(?:["']${w}["']|\\{[^}]*["']${w}["'][^}]*\\})`).test(text);
          if (used) this.error(`${file} uses the "${w}" icon weight, which vite.config.ts drops from the build.`);
        }
      }
    },
    transform(code, id) {
      if (!/[\\/]@phosphor-icons[\\/]react[\\/]dist[\\/]defs[\\/]/.test(id)) return null;
      let out = code;
      for (const w of drop) {
        const start = out.search(new RegExp(`\\[\\s*"${w}",`));
        if (start < 0) continue;
        const end = closingBracket(out, start);
        if (end < 0) this.error(`phosphor-weights: can't read the "${w}" entry of ${id}`);
        out = out.slice(0, start) + out.slice(end).replace(/^\s*,/, "");
      }
      return { code: out, map: null };
    },
  };
}

export default defineConfig({
  plugins: [phosphorWeights(), react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5173 },
});
