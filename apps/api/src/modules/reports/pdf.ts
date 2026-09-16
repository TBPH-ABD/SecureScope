import PDFDocument from "pdfkit";
import type { ReportContent } from "./builder.js";

const COLORS = {
  ink: "#0f172a",
  muted: "#64748b",
  line: "#e2e8f0",
  brand: "#0891b2",
  CRITICAL: "#b91c1c",
  HIGH: "#ea580c",
  MEDIUM: "#ca8a04",
  LOW: "#2563eb",
  INFO: "#64748b",
} as const;

const SEV_LABEL = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low", INFO: "Info" } as const;

// pdfkit's built-in fonts are WinAnsi; strip anything they cannot render.
const safe = (s: unknown) => String(s ?? "").replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, "?");

export function renderReportPdf(title: string, r: ReportContent): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, info: { Title: safe(title), Author: "SecureScope" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = doc.page.width - 100;
    const ensure = (h: number) => {
      if (doc.y + h > doc.page.height - 70) doc.addPage();
    };
    const heading = (text: string) => {
      ensure(60);
      doc.x = 50;
      doc.moveDown(1).fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(15).text(text, 50, doc.y, { width });
      doc.moveTo(50, doc.y + 4).lineTo(50 + width, doc.y + 4).strokeColor(COLORS.line).lineWidth(1).stroke();
      doc.moveDown(0.8);
    };

    // ── Cover ──
    doc.rect(0, 0, doc.page.width, 230).fill("#0b1220");
    doc.fillColor(COLORS.brand).font("Helvetica-Bold").fontSize(11).text("SECURESCOPE", 50, 60, { characterSpacing: 3 });
    doc.fillColor("#ffffff").fontSize(26).text(safe(title), 50, 90, { width });
    doc.fillColor("#94a3b8").font("Helvetica").fontSize(11)
      .text(`${safe(r.organization)}  |  Generated ${new Date(r.generatedAt).toUTCString()}`, 50, doc.y + 10)
      .text(`Prepared by ${safe(r.generatedBy)}  |  Scope: ${r.scope.assetIds ? `${r.scope.assetCount} selected asset(s)` : `all ${r.scope.assetCount} asset(s)`}`);
    doc.fillColor("#f59e0b").fontSize(9).text("CONFIDENTIAL - contains security-sensitive information", 50, 200);

    // ── Score tiles ──
    const s = r.summary;
    const tiles: Array<[string, string, string]> = [
      ["Security score", `${s.score}/100`, `Grade ${s.grade}`],
      ["Risk level", s.riskLevel, `${s.openFindings} open issue(s)`],
      ["Verified assets", String(s.verifiedAssets), `${r.scope.assetCount} in scope`],
      ["Resolved (30d)", String(s.resolvedLast30Days), s.lastScanAt ? `Last scan ${s.lastScanAt.slice(0, 10)}` : "No scans yet"],
    ];
    const tileW = (width - 30) / 4;
    tiles.forEach(([label, value, sub], i) => {
      const x = 50 + i * (tileW + 10);
      doc.roundedRect(x, 260, tileW, 78, 6).strokeColor(COLORS.line).stroke();
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(label.toUpperCase(), x + 10, 270, { width: tileW - 20 });
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(18).text(value, x + 10, 285, { width: tileW - 20 });
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(sub, x + 10, 315, { width: tileW - 20 });
    });
    doc.y = 360;

    heading("Executive summary");
    doc.font("Helvetica").fontSize(10.5).fillColor(COLORS.ink).text(safe(s.narrative), { width, lineGap: 3 });
    doc.moveDown(1);

    // Severity bar
    const total = Object.values(s.severityCounts).reduce((a, b) => a + b, 0);
    let bx = 50;
    const by = doc.y;
    for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const) {
      const n = s.severityCounts[sev];
      const w = total ? (n / total) * width : 0;
      if (w > 0) doc.rect(bx, by, w, 10).fill(COLORS[sev]);
      bx += w;
    }
    if (!total) doc.rect(50, by, width, 10).fill(COLORS.line);
    doc.y = by + 18;
    let lx = 50;
    for (const sev of ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"] as const) {
      doc.rect(lx, doc.y + 2, 7, 7).fill(COLORS[sev]);
      doc.fillColor(COLORS.ink).fontSize(9).text(`${SEV_LABEL[sev]}: ${s.severityCounts[sev]}`, lx + 11, doc.y, { lineBreak: false });
      lx += 95;
    }
    doc.x = 50;
    doc.moveDown(1.5);

    heading("Priority recommendations");
    if (r.recommendations.length === 0) {
      doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted).text("No remediation actions are outstanding.");
    }
    for (const rec of r.recommendations) {
      ensure(50);
      doc.x = 50;
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(COLORS.ink)
        .text(`${rec.priority}. ${safe(rec.title)}  `, { continued: true })
        .font("Helvetica").fillColor(COLORS.muted).text(`(${rec.affected} asset${rec.affected === 1 ? "" : "s"})`);
      doc.font("Helvetica").fontSize(9.5).fillColor(COLORS.ink).text(safe(rec.detail), { width, indent: 14, lineGap: 2 });
      doc.moveDown(0.5);
    }

    heading("Affected assets");
    const cols = [0, 220, 320, 400];
    const row = (cells: string[], bold = false) => {
      ensure(18);
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(bold ? COLORS.muted : COLORS.ink);
      cells.forEach((c, i) => doc.text(safe(c), 50 + cols[i]!, y, { width: (cols[i + 1] ?? width) - cols[i]! - 8, lineBreak: false, ellipsis: true }));
      doc.x = 50;
      doc.y = y + 16;
      doc.moveTo(50, doc.y - 3).lineTo(50 + width, doc.y - 3).strokeColor(COLORS.line).lineWidth(0.5).stroke();
    };
    row(["Asset", "Type", "Open issues", "Highest severity"], true);
    for (const a of r.assets) row([a.value, a.type.replace("_", " "), String(a.open), a.worst ? SEV_LABEL[a.worst] : "-"]);

    heading("Findings");
    if (r.findings.length === 0) doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted).text("No open findings.");
    for (const f of r.findings) {
      ensure(110);
      const y = doc.y;
      doc.roundedRect(50, y, 58, 14, 3).fill(COLORS[f.severity]);
      doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5).text(SEV_LABEL[f.severity].toUpperCase(), 50, y + 4, { width: 58, align: "center" });
      doc.fillColor(COLORS.ink).fontSize(11).text(safe(f.title), 116, y + 1, { width: width - 66 });
      doc.font("Helvetica").fontSize(8.5).fillColor(COLORS.muted)
        .text(`${safe(f.asset)}  |  ${f.status.replace("_", " ")}  |  first seen ${f.firstSeenAt.slice(0, 10)}`, 116, doc.y + 2);
      doc.moveDown(0.4);
      doc.x = 50;
      doc.fillColor(COLORS.ink).fontSize(9.5).text(safe(f.description), { width, lineGap: 2 });
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").text("Remediation: ", { continued: true }).font("Helvetica").text(safe(f.remediation), { width, lineGap: 2 });
      const ev = JSON.stringify(f.evidence);
      if (ev && ev !== "{}") {
        doc.moveDown(0.3);
        doc.font("Courier").fontSize(7.5).fillColor(COLORS.muted).text(safe(ev.length > 600 ? `${ev.slice(0, 600)}...` : ev), { width });
      }
      doc.moveDown(1);
    }

    heading("Methodology");
    doc.font("Helvetica").fontSize(9.5).fillColor(COLORS.ink).text(
      "Findings were produced by non-intrusive external checks run only against assets whose ownership or testing authorization was verified: " +
        "DNS record analysis, e-mail domain policy (SPF/DMARC/MTA-STS), TLS certificate and protocol inspection, HTTP security header review, " +
        "TCP connect checks against a limited list of common service ports, and passive technology fingerprinting. " +
        "The security score starts at 100 and deducts weighted penalties for open findings by severity. " +
        "External scanning cannot observe internal controls; this report should be read alongside internal assessments.",
      { width, lineGap: 2 },
    );

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom margin would otherwise trigger an automatic page break.
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted)
        .text(`SecureScope  |  ${safe(r.organization)}  |  Confidential  |  Page ${i + 1} of ${range.count}`, 50, doc.page.height - 40, {
          width, align: "center", lineBreak: false,
        });
    }
    doc.end();
  });
}
