import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface FraudReportTransaction {
  service: string;
  amount: string;
  reason?: string | null;
  time: string;
  status: "SAFE" | "SUSPICIOUS" | "PENDING";
  risk_score?: number;
  location?: string;
  device_id?: string;
}

const FOOTER_TEXT = "Generated for Central Bank of Somalia Compliance - Confidential";

export function downloadFraudReportPdf(transactions: FraudReportTransaction[]) {
  // Exclude PENDING from the report to focus on completed analysis
  const validTx = transactions.filter((tx) => tx.status !== "PENDING");
  
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margin = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // 1. Visual Branding: Dark, full-width header bar
  doc.setFillColor(15, 23, 42); // very dark slate
  doc.rect(0, 0, pageWidth, 28, "F");
  
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("SOMALIGUARD: ADVANCED FORENSIC ANALYSIS", pageWidth / 2, 12, { align: "center" });
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225); // slate-300
  doc.text("INCIDENT FORENSIC REPORT", pageWidth / 2, 20, { align: "center" });

  let curY = 36;

  // Compute stats for "Red rows" (score > 90)
  let totalThreats = 0;
  let capitalProtected = 0;

  const parsedAmount = (val: string) => {
    const num = parseFloat(val.replace(/[^0-9.-]/g, ""));
    return isNaN(num) ? 0 : num;
  };

  validTx.forEach(tx => {
    const score = tx.risk_score ?? 0;
    // According to the requirement, Red rows = riskScore > 90
    if (score > 90) {
      totalThreats++;
      capitalProtected += parsedAmount(tx.amount);
    }
  });

  // 2. The 'Shock' Summary - 2-column "Quick Stats" box
  doc.setFillColor(241, 245, 249); // slate-100
  doc.setDrawColor(203, 213, 225); // slate-300
  doc.setLineWidth(0.5);
  doc.rect(margin, curY, pageWidth - margin * 2, 24, "FD");

  // Left Column
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139); // slate-500
  doc.setFont("helvetica", "bold");
  doc.text("High-Risk Threats Neutralized", margin + 6, curY + 8);
  
  doc.setFontSize(18);
  doc.setTextColor(220, 38, 38); // red-600
  doc.text(totalThreats.toString(), margin + 6, curY + 18);

  // Right Column
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text("Total Capital Protected", pageWidth / 2 + 6, curY + 8);
  
  doc.setFontSize(18);
  doc.setTextColor(22, 163, 74); // green-600
  doc.text(`$${capitalProtected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, pageWidth / 2 + 6, curY + 18);

  curY += 34;

  // 3. Audit Details
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105);
  doc.text("Authentication Method: Multi-Factor EVC-Plus Logic Gate", margin, curY);
  curY += 5;
  doc.text("Analysis Engine: Random Forest Classifier (Optimized for EVC-Plus Patterns)", margin, curY);
  curY += 5;
  doc.text("Officer: Atika Isse Ali", margin, curY);
  curY += 8;

  // 4. Table Design
  const body = validTx.map((tx) => {
    const score = tx.risk_score ?? 0;
    const isHighRisk = score > 70 || tx.status === "SUSPICIOUS";
    const statusText = isHighRisk ? "BLOCKED" : "VERIFIED";
    return [
      tx.service,
      tx.amount,
      `${score}%`,
      tx.device_id || "Unknown",
      tx.location || "Mogadishu",
      statusText,
    ];
  });

  autoTable(doc, {
    startY: curY,
    head: [["Service", "Amount", "Risk %", "Device", "Location", "Status"]],
    body: body.length ? body : [["—", "—", "—", "No transactions recorded", "—", "—"]],
    theme: "striped",
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 9, cellPadding: 3, textColor: [51, 65, 85] },
    alternateRowStyles: { fillColor: [248, 250, 252] }, // Zebra stripe
    columnStyles: {
      0: { cellWidth: 30 }, // Service
      1: { cellWidth: 26 }, // Amount
      2: { cellWidth: 16 }, // Risk %
      3: { cellWidth: 40 }, // Device
      4: { cellWidth: 38 }, // Location
      5: { cellWidth: 32 }, // Status
    },
    willDrawCell: (data) => {
      // If riskScore > 90, the entire row's text must be CRITICAL RED and Bold
      if (data.section === "body" && body.length > 0 && data.row.index < validTx.length) {
        const tx = validTx[data.row.index];
        const score = tx.risk_score ?? 0;
        if (score > 90) {
          doc.setTextColor(220, 38, 38); // CRITICAL RED
          doc.setFont("helvetica", "bold");
        }
      }
    },
    margin: { left: margin, right: margin, bottom: 28 },
    didDrawPage: (data) => {
      // 5. Professional Stamp at bottom right
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(220, 38, 38);
      
      const stampText = "VERIFIED BY AI ENGINE";
      const txtWidth = doc.getTextWidth(stampText);
      const stampX = pageWidth - margin - txtWidth - 6;
      const stampY = pageHeight - 20;
      
      doc.setDrawColor(220, 38, 38);
      doc.setLineWidth(0.8);
      doc.rect(stampX - 4, stampY - 6, txtWidth + 8, 10);
      doc.text(stampText, stampX, stampY);
      
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text(FOOTER_TEXT, pageWidth / 2, pageHeight - 10, { align: "center" });
    },
  });

  doc.save(`somali-guard-fraud-export-${new Date().toISOString().slice(0, 10)}.pdf`);
}
