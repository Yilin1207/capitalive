import "server-only";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

// Bundle OFL-licensed Noto Sans. Vercel's runtime has no guaranteed system fonts.
// Disable system font discovery so local and Linux/Vercel rendering use identical glyphs.
export function chartPng(svg: string): Buffer {
  const renderer = new Resvg(svg, { font: { fontFiles: [join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf")], loadSystemFonts: false, defaultFontFamily: "Noto Sans" } });
  return renderer.render().asPng();
}
