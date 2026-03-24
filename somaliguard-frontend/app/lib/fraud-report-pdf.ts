import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface FraudReportTransaction {
  service: string;
  amount: string;
  reason?: string | null;
  time: string;
  status: "SAFE" | "SUSPICIOUS" | "PENDING";
}

/** Draw SomaliGuard brand header (shield + wordmark) — returns Y position below header. */
function drawSomaliGuardLogo(doc: jsPDF, marginLeft: number, top: number): number {
  const shieldW = 22;
  const shieldH = 28;
  doc.setFillColor(37, 99, 235);
  doc.roundedRect(marginLeft, top, shieldW, shieldH, 2, 2, "F");
  doc.setDrawColor(30, 64, 175);
  doc.setLineWidth(0.3);
  doc.roundedRect(marginLeft, top, shieldW, shieldH, 2, 2, "S");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("SG", marginLeft + shieldW / 2, top + shieldH / 2 + 2, { align: "center" });

  const textX = marginLeft + shieldW + 6;
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(15);
  doc.text("SOMALIGUARD", textX, top + 10);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text("AI Fraud Detection System", textX, top + 17);

  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text("Somalia · Banking Security", textX, top + 22);

  return top + shieldH + 8;
}

const FOOTER_TEXT = "Generated for Central Bank of Somalia Compliance - Confidential";

/** Build PDF of SUSPICIOUS rows only; SomaliGuard logo + compliance footer. */
export function downloadFraudReportPdf(transactions: FraudReportTransaction[]) {
  const suspicious = transactions.filter((tx) => tx.status === "SUSPICIOUS");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const tableTop = drawSomaliGuardLogo(doc, margin, 12);

  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Report date: ${new Date().toLocaleString()}`, margin, tableTop - 2);
  doc.text(`Suspicious items: ${suspicious.length}`, pageWidth - margin, tableTop - 2, { align: "right" });

  const body = suspicious.map((tx) => [
    tx.service,
    tx.amount,
    tx.reason?.replace(/\s+/g, " ") ?? "—",
    tx.time,
  ]);

  autoTable(doc, {
    startY: tableTop + 2,
    head: [["Service", "Amount", "Reason", "Time"]],
    body: body.length ? body : [["—", "—", "No suspicious transactions", "—"]],
    theme: "striped",
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: {
      0: { cellWidth: 32 },
      1: { cellWidth: 28 },
      2: { cellWidth: 72 },
      3: { cellWidth: 38 },
    },
    margin: { left: margin, right: margin, bottom: 18 },
    didDrawPage: () => {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7);
      doc.setTextColor(90, 90, 90);
      doc.text(FOOTER_TEXT, pageWidth / 2, pageHeight - 10, { align: "center" });
    },
  });

  doc.save(`somali-guard-fraud-export-${new Date().toISOString().slice(0, 10)}.pdf`);
}
