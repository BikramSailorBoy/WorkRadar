// Renders a Markdown file to an A4 PDF with Chromium. Usage: node docs/src/render-pdf.mjs in.md out.pdf
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [, , src, out] = process.argv;
const body = execFileSync("python3", ["-c", "import sys,markdown;print(markdown.markdown(open(sys.argv[1]).read(),extensions=['tables']))", src]).toString();
const css = `@page{size:A4;margin:13mm 14mm 13mm 14mm}
body{font-family:Inter,'Helvetica Neue',Arial,sans-serif;font-size:9.7pt;line-height:1.4;color:#14202e}
h1{font-size:17pt;margin:0 0 2px;color:#0b3a66;letter-spacing:-.01em}
.by{color:#5b6b7c;font-size:8.3pt;margin:0 0 6px}
h2{break-after:avoid;font-size:11pt;color:#0b3a66;margin:9px 0 3px;padding-bottom:2px;border-bottom:1px solid #cfe0f0}
p{margin:0 0 4px} ul{margin:0 0 4px;padding-left:15px} li{margin:0 0 1px}
table{border-collapse:collapse;width:100%;margin:2px 0 4px;font-size:8.9pt;page-break-inside:avoid}
th{background:#eaf3fb;color:#0b3a66;text-align:left;font-weight:600}
th,td{border:1px solid #d5e2ee;padding:2.5px 5px;vertical-align:top}
strong{color:#0b2a48}`;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await b.newPage();
await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`);
await p.pdf({ path: out, format: "A4", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>",
  footerTemplate: `<div style="font-size:7pt;color:#8a99a8;width:100%;text-align:center">WorkRadar PRD · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
  margin: { top: "13mm", bottom: "14mm", left: "14mm", right: "14mm" } });
await b.close();
