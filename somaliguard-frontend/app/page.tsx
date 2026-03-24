"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  Globe,
  Activity,
  ShieldCheck,
  Clock,
  CreditCard,
  RefreshCw,
  Zap,
  BarChart3,
  FileDown,
  UserCircle,
  Ban,
  X,
  DollarSign,
  Radar,
  Fingerprint,
} from "lucide-react";
import { downloadFraudReportPdf } from "./lib/fraud-report-pdf";
import { motion } from "framer-motion";
import confetti from "canvas-confetti";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

type Lang = "EN" | "SO";

interface Transaction {
  id: string;
  service: string;
  amount: string;
  status: "SAFE" | "SUSPICIOUS" | "PENDING";
  time: string;
  reason?: string | null;
}

// API response item: backend may send status or risk_score
interface TransactionApiItem {
  id: string;
  service: string;
  amount: string;
  status?: "SAFE" | "SUSPICIOUS" | "PENDING";
  risk_score?: number;
  time: string;
  reason?: string | null;
}

const TRANSACTIONS_STORAGE_KEY = "somaliguard.transactions";

function mapApiToTransaction(item: TransactionApiItem): Transaction {
  let status: Transaction["status"] = "PENDING";
  if (item.status) {
    status = item.status;
  } else if (typeof item.risk_score === "number") {
    const threshold = item.risk_score > 1 ? 50 : 0.5;
    status = item.risk_score >= threshold ? "SUSPICIOUS" : "SAFE";
  }
  let reason = item.reason ?? null;
  if (status === "SUSPICIOUS" && !reason) {
    reason = "Pattern Anomaly";
  }
  return {
    id: item.id,
    service: item.service,
    amount: item.amount,
    status,
    time: item.time,
    reason,
  };
}

function mapPredictionToStatus(prediction: string): Transaction["status"] {
  const p = prediction.trim().toUpperCase();
  if (p === "SAFE") return "SAFE";
  if (p === "FRAUD" || p === "SUSPICIOUS") return "SUSPICIOUS";
  return "PENDING";
}

function formatAmountDisplay(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function parseCurrencyAmount(value: string): number {
  const n = Number.parseFloat(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeServiceKey(service: string): "EVC" | "Sahal" | "Zaad" | "Other" {
  const value = service.trim().toLowerCase();
  if (value.includes("evc")) return "EVC";
  if (value.includes("sahal")) return "Sahal";
  if (value.includes("zaad")) return "Zaad";
  return "Other";
}

function isCriticalTransaction(tx: Transaction): boolean {
  if (tx.status !== "SUSPICIOUS") return false;
  const amount = parseCurrencyAmount(tx.amount);
  const key = normalizeServiceKey(tx.service);
  if (key === "EVC" && amount > 500) return true;
  if (key === "Sahal" && amount > 1000) return true;
  if (key === "Zaad" && amount > 2000) return true;
  return /money\s*laundering|bot\/script|night-time/i.test(tx.reason ?? "");
}

function isMoneyLaunderingReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return /money\s*laundering/i.test(reason);
}

export default function SomaliGuardDashboard() {
  const [lang, setLang] = useState<Lang>("EN");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [scanAmount, setScanAmount] = useState("");
  const [scanService, setScanService] = useState("EVC Plus");
  const [scanning, setScanning] = useState(false);
  const [pendingScanId, setPendingScanId] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [amountError, setAmountError] = useState(false);
  const [launderingAlertOpen, setLaunderingAlertOpen] = useState(false);
  const [launderingAlertDetail, setLaunderingAlertDetail] = useState("");
  const launderingAlertedIds = useRef<Set<string>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);
  const [showIdentityScan, setShowIdentityScan] = useState(true);
  const [badgeTilt, setBadgeTilt] = useState({ rotateX: 0, rotateY: 0 });

  const FRAUD_CHECK_URL = "http://localhost:3001/fraud/check";

  const playSynthTone = (frequency: number, durationMs: number) => {
    if (typeof window === "undefined") return;
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const context = new AudioContextCtor();
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.value = 0.02;
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start();
    osc.stop(context.currentTime + durationMs / 1000);
    osc.onended = () => {
      void context.close();
    };
  };

  const playSound = (kind: "scan" | "fraud" | "block") => {
    if (typeof window === "undefined") return;
    const fileMap = {
      scan: "/sounds/scan-start.mp3",
      fraud: "/sounds/fraud-detected.mp3",
      block: "/sounds/account-blocked.mp3",
    };
    const fallbackTone = {
      scan: () => playSynthTone(620, 180),
      fraud: () => playSynthTone(340, 260),
      block: () => playSynthTone(220, 320),
    };
    try {
      const audio = new Audio(fileMap[kind]);
      audio.volume = 0.35;
      void audio.play().catch(() => fallbackTone[kind]());
    } catch {
      fallbackTone[kind]();
    }
  };

  const handleBlockAccount = (event: React.MouseEvent<HTMLButtonElement>) => {
    playSound("block");
    const rect = event.currentTarget.getBoundingClientRect();
    const origin = {
      x: (rect.left + rect.width / 2) / window.innerWidth,
      y: (rect.top + rect.height / 2) / window.innerHeight,
    };
    void confetti({
      particleCount: 70,
      spread: 80,
      startVelocity: 40,
      origin,
      ticks: 140,
      gravity: 0.9,
      colors: ["#22d3ee", "#38bdf8", "#f43f5e", "#0f172a", "#cbd5e1"],
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => setShowIdentityScan(false), 2000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(TRANSACTIONS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const safeRows = parsed.filter(
        (item): item is Transaction =>
          !!item &&
          typeof item.id === "string" &&
          typeof item.service === "string" &&
          typeof item.amount === "string" &&
          (item.status === "SAFE" || item.status === "SUSPICIOUS" || item.status === "PENDING")
      );
      if (safeRows.length > 0) {
        setTransactions(safeRows);
      }
    } catch {
      // Ignore invalid localStorage JSON to avoid render crashes.
    }
  }, []);

  useEffect(() => {
    async function fetchTransactions() {
      try {
        const res = await fetch("http://localhost:3001/transactions");
        const data: TransactionApiItem[] = await res.json();
        setTransactions(data.map(mapApiToTransaction));
      } catch {
        setTransactions([]);
      }
    }
    fetchTransactions();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(TRANSACTIONS_STORAGE_KEY, JSON.stringify(transactions));
    } catch {
      // Ignore storage quota/privacy errors.
    }
  }, [transactions]);

  useEffect(() => {
    for (const tx of transactions) {
      if (
        tx.status === "SUSPICIOUS" &&
        isMoneyLaunderingReason(tx.reason) &&
        !launderingAlertedIds.current.has(tx.id)
      ) {
        launderingAlertedIds.current.add(tx.id);
        setLaunderingAlertDetail(tx.reason ?? "");
        setLaunderingAlertOpen(true);
        break;
      }
    }
  }, [transactions]);

  const verifiedSafeCount = transactions.filter((tx) => tx.status === "SAFE").length;
  const flaggedCount = transactions.filter((tx) => tx.status === "SUSPICIOUS").length;

  const totalTransactionVolume = useMemo(
    () =>
      transactions
        .filter((tx) => tx.status !== "PENDING")
        .reduce((sum, tx) => sum + parseCurrencyAmount(tx.amount), 0),
    [transactions]
  );

  const fraudByServiceData = useMemo(() => {
    const counts = { EVC: 0, Sahal: 0, Zaad: 0 };
    for (const tx of transactions) {
      if (tx.status !== "SUSPICIOUS") continue;
      const key = normalizeServiceKey(tx.service);
      if (key === "EVC") counts.EVC += 1;
      if (key === "Sahal") counts.Sahal += 1;
      if (key === "Zaad") counts.Zaad += 1;
    }
    return {
      labels: ["EVC", "Sahal", "Zaad"],
      datasets: [
        {
          label: "Suspicious Transactions",
          data: [counts.EVC, counts.Sahal, counts.Zaad],
          backgroundColor: ["rgba(56, 189, 248, 0.7)", "rgba(251, 113, 133, 0.7)", "rgba(251, 191, 36, 0.7)"],
          borderColor: ["rgba(56, 189, 248, 1)", "rgba(251, 113, 133, 1)", "rgba(251, 191, 36, 1)"],
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    };
  }, [transactions]);

  useEffect(() => {
    if (!isDemoMode) return;
    if (typeof window === "undefined") return;

    const services = ["EVC Plus", "Sahal", "Zaad"] as const;
    const createMockTransaction = (): Transaction => {
      const service = services[Math.floor(Math.random() * services.length)];
      const isSafe = Math.random() < 0.7; // 70% SAFE, 30% SUSPICIOUS
      const suspicious = !isSafe;
      const amount = isSafe
        ? Number((Math.random() * 145 + 5).toFixed(2)) // $5-$150
        : service === "EVC Plus"
          ? Number((Math.random() * 700 + 520).toFixed(2))
          : service === "Sahal"
            ? Number((Math.random() * 1300 + 1050).toFixed(2))
            : Number((Math.random() * 2200 + 2050).toFixed(2));
      const timeTags = ["Morning", "Afternoon", "Night-Time"] as const;
      const period = timeTags[Math.floor(Math.random() * timeTags.length)];
      const reasons = [
        "Exceeded EVC Limit",
        "Exceeded Sahal Limit",
        "Exceeded Zaad Limit",
        "Pattern Anomaly",
        `${period} Transaction`,
      ];

      return {
        id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        service,
        amount: formatAmountDisplay(amount),
        status: suspicious ? "SUSPICIOUS" : "SAFE",
        time: "Live Feed",
        reason: suspicious ? reasons[Math.floor(Math.random() * reasons.length)] : "Verified by AI Engine",
      };
    };

    const pushDemoTransaction = () => {
      const mock = createMockTransaction();
      if (mock.status === "SUSPICIOUS") {
        playSound("fraud");
      }
      setTransactions((prev) => [mock, ...prev].slice(0, 50));
    };

    pushDemoTransaction(); // Start immediately on toggle ON
    const timer = setInterval(() => {
      pushDemoTransaction();
    }, 1000);

    return () => clearInterval(timer);
  }, [isDemoMode]);

  const handleScan = async () => {
    playSound("scan");
    const amountNum = parseFloat(scanAmount);
    const trimmed = scanAmount.trim();
    if (trimmed === "" || Number.isNaN(amountNum) || amountNum <= 0) {
      setAmountError(true);
      return;
    }

    setAmountError(false);
    setScanError(null);

    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const placeholder: Transaction = {
      id: pendingId,
      service: scanService,
      amount: formatAmountDisplay(amountNum),
      status: "PENDING",
      time: "Just now",
      reason: null,
    };

    setScanning(true);
    setPendingScanId(pendingId);
    setTransactions((prev) => [placeholder, ...prev]);

    try {
      const res = await fetch(FRAUD_CHECK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          amount: amountNum,
          service: scanService,
        }),
      });

      const rawText = await res.text();
      let data: { prediction?: string; reason?: string | null; message?: string | string[] };
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(`Server returned invalid JSON (HTTP ${res.status}). Is the backend running on :3001?`);
      }

      if (!res.ok) {
        const msg = data.message;
        const detail = Array.isArray(msg) ? msg.join(", ") : msg || rawText || `HTTP ${res.status}`;
        throw new Error(detail);
      }

      const pred = String(data.prediction ?? "").trim().toUpperCase();
      if (pred !== "SAFE" && pred !== "SUSPICIOUS") {
        throw new Error(`Unexpected response: missing prediction (got: ${rawText.slice(0, 200)})`);
      }

      const status: Transaction["status"] = pred === "SUSPICIOUS" ? "SUSPICIOUS" : "SAFE";
      if (status === "SUSPICIOUS") playSound("fraud");

      setTransactions((prev) =>
        prev.map((tx) =>
          tx.id === pendingId
            ? {
                ...tx,
                service: scanService,
                amount: formatAmountDisplay(amountNum),
                status,
                reason: data.reason ?? (status === "SUSPICIOUS" ? "Pattern Anomaly" : null),
              }
            : tx
        )
      );
    } catch (err) {
      const isNetworkFailure =
        err instanceof TypeError ||
        (err instanceof Error && /failed to fetch|networkerror|load failed|network request failed/i.test(err.message));

      if (isNetworkFailure) {
        setScanError(null);
      } else {
        const message = err instanceof Error ? err.message : "Scan failed";
        setScanError(message);
      }

      const reasonForRow = isNetworkFailure ? "Connection Error" : err instanceof Error ? err.message : "Connection Error";

      setTransactions((prev) =>
        prev.map((tx) =>
          tx.id === pendingId
            ? {
                ...tx,
                service: scanService,
                amount: formatAmountDisplay(amountNum),
                status: "PENDING",
                reason: reasonForRow,
              }
            : tx
        )
      );
    } finally {
      setScanning(false);
      setPendingScanId(null);
    }
  };

  const t = {
    EN: {
      title: "SOMALIGUARD",
      sub: "AI Fraud Detection System",
      btn: "SCAN TRANSACTION",
      scanning: "Scanning…",
      history: "Live Security Log",
      amount: "Amount ($)",
      service: "Service Type",
      status: "Security Status",
      time: "Time",
      safe: "SAFE",
      suspicious: "SUSPICIOUS",
      pending: "PENDING",
      newScan: "New Scan",
      stats: "System Status",
      lastScan: "Last scan: Active",
      verifiedSafe: "Verified Safe",
      flagged: "Flagged",
      amountRequired: "Please enter a valid amount greater than zero.",
      reason: "Reason",
      officerName: "Officer: Atika Ali",
      activeStatus: "Active",
      demoMode: "Demo Mode",
      fraudByService: "Fraud by Service Type",
      commandBrand: "Officer Atika Ali - Central Security Division",
      downloadReport: "Export Fraud Report (PDF)",
      totalVolume: "Total Transaction Volume ($)",
      actionCol: "Action",
      blockAccount: "Block Account",
      highRiskTitle: "High Risk Alert",
      highRiskBody: "Money laundering pattern detected. Escalate to compliance immediately.",
      dismiss: "Dismiss",
    },
    SO: {
      title: "SOMALIGUARD",
      sub: "Nidaamka Baarista Is-dabamarinta AI",
      btn: "BAARITAAN BILOW",
      scanning: "Waa la baarayaa…",
      history: "Diiwaanka Amniga Tooska ah",
      amount: "Lacagta ($)",
      service: "Nooca Adeegga",
      status: "Heerka Amniga",
      time: "Waqtiga",
      safe: "BADAN",
      suspicious: "SHAAKKU",
      pending: "Sugitaanka",
      newScan: "Baaritaan Cusub",
      stats: "Heerka Nidaamka",
      lastScan: "Baaritaan ugu dambeeyay: Firfircoon",
      verifiedSafe: "La xaqiijiyay Badan",
      flagged: "Lagu calaamadeeyay",
      amountRequired: "Fadlan gali lacag sax ah oo ka badan eber.",
      reason: "Sabab",
      officerName: "Sarkaalka: Atika Ali",
      activeStatus: "Firfircoon",
      demoMode: "Habka Demo",
      fraudByService: "Khiyaanooyinka Adeegga",
      commandBrand: "Sarkaal Atika Ali - Qaybta Amniga Dhexe",
      downloadReport: "Soo saar Warbixinta Khiyaanooyinka (PDF)",
      totalVolume: "Wadarta Lacagaha La Baaray ($)",
      actionCol: "Ficil",
      blockAccount: "Xir Akoonka",
      highRiskTitle: "Digniin Khatar Sare",
      highRiskBody: "Waxaa la ogaaday qaab lacag-xireyn. U gudbi qaybta waafaqida.",
      dismiss: "Xir",
    },
  };

  const getStatusLabel = (status: Transaction["status"]) =>
    status === "SAFE" ? t[lang].safe : status === "SUSPICIOUS" ? t[lang].suspicious : t[lang].pending;

  const getStatusStyles = (status: Transaction["status"]) => {
    switch (status) {
      case "SAFE":
        return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
      case "SUSPICIOUS":
        return "bg-rose-500/15 text-rose-400 border-rose-500/30";
      default:
        return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    }
  };

  const handleDownloadPdf = () => {
    downloadFraudReportPdf(transactions);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {showIdentityScan && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/90 backdrop-blur-md">
          <div className="rounded-2xl border border-emerald-400/40 bg-slate-900/85 px-10 py-8 shadow-[0_0_45px_rgba(16,185,129,0.22)]">
            <div className="flex items-center gap-4 text-emerald-300">
              <Fingerprint className="w-10 h-10 animate-pulse drop-shadow-[0_0_10px_rgba(16,185,129,0.75)]" />
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-emerald-400/80">Biometric Gate</p>
                <p className="text-xl font-semibold">Scanning Identity...</p>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="scanline-overlay" aria-hidden />
      {/* High Risk — Money Laundering */}
      {launderingAlertOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="laundering-alert-title"
        >
          <div className="relative max-w-md w-full rounded-2xl border-4 border-red-400 bg-red-600 p-6 shadow-2xl shadow-red-900/60 ring-4 ring-red-500/50">
            <button
              type="button"
              onClick={() => setLaunderingAlertOpen(false)}
              className="absolute top-3 right-3 p-1.5 rounded-lg bg-red-700/80 hover:bg-red-800 text-white"
              aria-label={t[lang].dismiss}
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-start gap-3 pr-8">
              <AlertTriangle className="w-10 h-10 text-white shrink-0 drop-shadow-md" />
              <div>
                <h2 id="laundering-alert-title" className="text-xl font-black text-white tracking-tight uppercase">
                  {t[lang].highRiskTitle}
                </h2>
                <p className="mt-2 text-sm font-semibold text-red-50 leading-relaxed">{t[lang].highRiskBody}</p>
                {launderingAlertDetail && (
                  <p className="mt-3 text-xs text-red-100/90 font-mono bg-red-800/50 rounded-lg px-3 py-2 border border-red-400/30">
                    {launderingAlertDetail}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setLaunderingAlertOpen(false)}
                  className="mt-5 w-full py-2.5 rounded-xl bg-white text-red-700 font-bold text-sm hover:bg-red-50 transition-colors"
                >
                  {t[lang].dismiss}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ambient gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl" />
        <div className="absolute top-1/2 -left-40 w-80 h-80 bg-indigo-600/15 rounded-full blur-3xl" />
      </div>

      <motion.div
        className="fixed top-3 right-6 z-50 flex items-center gap-3 rounded-xl border border-slate-600/70 bg-slate-900/80 px-4 py-2 shadow-[0_12px_28px_rgba(2,6,23,0.55)] backdrop-blur-md"
        animate={{ y: [0, -2, 0] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
        style={{
          transformStyle: "preserve-3d",
          transform: `perspective(900px) rotateX(${badgeTilt.rotateX}deg) rotateY(${badgeTilt.rotateY}deg)`,
        }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = (e.clientX - rect.left) / rect.width;
          const relY = (e.clientY - rect.top) / rect.height;
          setBadgeTilt({
            rotateX: Number(((0.5 - relY) * 6).toFixed(2)),
            rotateY: Number(((relX - 0.5) * 8).toFixed(2)),
          });
        }}
        onMouseLeave={() => setBadgeTilt({ rotateX: 0, rotateY: 0 })}
      >
        <div className="text-[11px] sm:text-xs font-semibold tracking-[0.2em] uppercase bg-gradient-to-r from-amber-200 via-slate-100 to-amber-300 bg-clip-text text-transparent drop-shadow-[0_0_10px_rgba(251,191,36,0.35)]">
          {t[lang].commandBrand}
        </div>
        <button
          type="button"
          onClick={() => setIsDemoMode((prev) => !prev)}
          className={`px-3 py-1.5 rounded-lg border text-[11px] sm:text-xs font-bold tracking-wide ${
            isDemoMode
              ? "bg-emerald-500/25 border-emerald-400/70 text-emerald-200 shadow-[0_0_14px_rgba(16,185,129,0.35)]"
              : "bg-slate-900/85 border-slate-500/80 text-slate-200"
          }`}
          aria-pressed={isDemoMode}
        >
          {t[lang].demoMode}: {isDemoMode ? "ON" : "OFF"}
        </button>
      </motion.div>

      {/* Header */}
      <header className="relative border-b border-slate-800/80 bg-slate-900/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap gap-3 justify-between items-center">
          <div className="flex items-center gap-4 min-w-0">
            <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-600 to-slate-900 shadow-xl shadow-blue-500/20 ring-1 ring-blue-500/30">
              <Shield className="w-9 h-9 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2 flex-wrap">
                {t[lang].title}
                <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-blue-600/30 text-blue-300 border border-blue-500/30">
                  AI
                </span>
              </h1>
              <p className="text-slate-400 text-sm">{t[lang].sub}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 ml-auto">
            <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-slate-800/90 border border-slate-600/80 text-slate-200 text-xs sm:text-sm font-medium shadow-inner">
              <UserCircle className="w-5 h-5 text-blue-400 shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="whitespace-nowrap font-semibold text-white">{t[lang].officerName}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-emerald-400/95 mt-0.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 ring-2 ring-emerald-500/40" />
                  </span>
                  {t[lang].activeStatus}
                </span>
              </div>
            </div>
            <button
              onClick={() => setLang(lang === "EN" ? "SO" : "EN")}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-blue-500/50 text-slate-200 hover:text-white transition-all duration-200 font-medium"
              aria-label={lang === "EN" ? "Switch to Af-Soomaali" : "Switch to English"}
            >
              <Globe className="w-4 h-4" />
              <span>{lang === "EN" ? "Af-Soomaali" : "English"}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative max-w-7xl mx-auto px-6 py-8 pb-14">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Scan Form Card */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur overflow-hidden ring-1 ring-slate-700/50 shadow-2xl shadow-black/20">
            <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 px-6 py-4 border-b border-slate-700/50">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-300" />
                {t[lang].newScan}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">{t[lang].amount}</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={scanAmount}
                  onChange={(e) => {
                    setScanAmount(e.target.value);
                    setAmountError(false);
                  }}
                  min={0}
                  step="0.01"
                  aria-invalid={amountError}
                  aria-describedby={amountError ? "amount-error" : undefined}
                  className={`w-full p-3.5 bg-slate-800/50 border rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all ${
                    amountError ? "border-rose-500/70" : "border-slate-700"
                  }`}
                />
                {amountError && (
                  <p id="amount-error" className="mt-1.5 text-sm text-rose-500" role="alert">
                    {t[lang].amountRequired}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">{t[lang].service}</label>
                <select
                  value={scanService}
                  onChange={(e) => setScanService(e.target.value)}
                  className="w-full p-3.5 bg-slate-800/50 border border-slate-700 rounded-xl text-white focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                >
                  <option value="EVC Plus">EVC Plus</option>
                  <option value="Sahal">Sahal</option>
                  <option value="Zaad">Zaad</option>
                </select>
              </div>
              <button
                type="button"
                onClick={handleScan}
                disabled={scanning}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-cyan-600 to-blue-700 hover:from-cyan-500 hover:to-blue-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-xl transition-all shadow-lg shadow-cyan-500/25 ring-1 ring-cyan-500/30"
              >
                <span className="relative inline-flex">
                  <span className="absolute -inset-1 rounded-full bg-cyan-400/40 blur-sm animate-pulse" />
                  <Radar className="relative w-4 h-4" />
                </span>
                <ShieldCheck className="w-4 h-4" />
                {scanning ? t[lang].scanning : t[lang].btn}
              </button>
              <button
                type="button"
                onClick={() => setIsDemoMode((prev) => !prev)}
                className={`w-full mt-2 py-2.5 rounded-xl border text-sm font-semibold transition-colors ${
                  isDemoMode
                    ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                    : "bg-slate-800/80 border-slate-600 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {t[lang].demoMode}: {isDemoMode ? "ON" : "OFF"}
              </button>
              {scanError && (
                <p
                  className="text-sm text-rose-400 border border-rose-500/40 rounded-xl px-3 py-2.5 bg-rose-950/50"
                  role="alert"
                >
                  {scanError}
                </p>
              )}
            </div>
          </div>

          {/* Stats Card */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur overflow-hidden ring-1 ring-slate-700/50 shadow-2xl shadow-black/20">
            <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 px-6 py-4 border-b border-slate-700/50 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-300" />
                {t[lang].stats}
              </h2>
              <span className="flex items-center gap-1.5 text-blue-200/80 text-sm">
                <Zap className="w-4 h-4" />
                {t[lang].lastScan}
              </span>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="p-5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-4">
                <div className="p-2.5 rounded-xl bg-emerald-500/20">
                  <CheckCircle className="w-7 h-7 text-emerald-400" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-emerald-400">{verifiedSafeCount}</p>
                  <p className="text-sm text-slate-400">{t[lang].verifiedSafe}</p>
                </div>
              </div>
              <div className="p-5 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center gap-4">
                <div className="p-2.5 rounded-xl bg-blue-500/20">
                  <DollarSign className="w-7 h-7 text-blue-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl sm:text-3xl font-bold text-blue-400 truncate">
                    {formatAmountDisplay(totalTransactionVolume)}
                  </p>
                  <p className="text-sm text-slate-400 leading-snug">{t[lang].totalVolume}</p>
                </div>
              </div>
              <div className="p-5 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center gap-4">
                <div className="p-2.5 rounded-xl bg-rose-500/20">
                  <AlertTriangle className="w-7 h-7 text-rose-400" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-rose-400">{flaggedCount}</p>
                  <p className="text-sm text-slate-400">{t[lang].flagged}</p>
                </div>
              </div>
            </div>
            <div className="px-6 pb-6">
              <div className="rounded-xl border border-slate-700/70 bg-slate-900/70 p-4">
                <p className="text-sm font-semibold text-slate-300 mb-3">{t[lang].fraudByService}</p>
                <div className="h-48">
                  <Bar
                    data={fraudByServiceData}
                    options={{
                      maintainAspectRatio: false,
                      responsive: true,
                      plugins: {
                        legend: { labels: { color: "#cbd5e1" } },
                      },
                      scales: {
                        x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(100,116,139,0.2)" } },
                        y: { ticks: { color: "#94a3b8", precision: 0 }, grid: { color: "rgba(100,116,139,0.2)" } },
                      },
                    }}
                  />
                </div>
                {transactions.length === 0 && (
                  <p className="mt-3 text-xs text-slate-400">
                    Waiting for transactions. Chart auto-updates from live `transactions` state.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Live Security Log */}
        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur overflow-hidden ring-1 ring-slate-700/50 shadow-2xl shadow-black/20">
          <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 px-6 py-4 border-b border-slate-700/50 flex flex-wrap items-center gap-3">
            <CreditCard className="w-5 h-5 text-blue-300 shrink-0" />
            <h2 className="text-lg font-semibold text-white">{t[lang].history}</h2>
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-600 text-slate-100 text-sm font-medium transition-colors"
            >
              <FileDown className="w-4 h-4 text-blue-300" />
              {t[lang].downloadReport}
            </button>
            <RefreshCw className="w-4 h-4 text-blue-300/70 shrink-0" aria-hidden />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {t[lang].service}
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {t[lang].amount}
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {t[lang].status}
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {t[lang].reason}
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {t[lang].time}
                  </th>
                  <th className="px-4 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">
                    {t[lang].actionCol}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className={`hover:bg-slate-800/30 transition-colors ${
                      isCriticalTransaction(tx)
                        ? "bg-rose-950/40 ring-1 ring-inset ring-rose-500/60 shadow-[inset_0_0_30px_rgba(244,63,94,0.35)] critical-flicker"
                        : ""
                    } ${
                      scanning && pendingScanId === tx.id ? "animate-scan-row-pulse" : ""
                    }`}
                  >
                    <td className="px-6 py-4">
                      <span className="font-medium text-slate-200">{tx.service}</span>
                    </td>
                    <td className="px-6 py-4 text-slate-300 font-mono">{tx.amount}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border ${getStatusStyles(
                          tx.status
                        )}`}
                      >
                        {tx.status === "SAFE" && <CheckCircle className="w-3.5 h-3.5 mr-1.5" />}
                        {tx.status === "SUSPICIOUS" && <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />}
                        {getStatusLabel(tx.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-400 text-sm max-w-xs">
                      {tx.status === "SUSPICIOUS" && tx.reason ? (
                        <span className="text-rose-300/90">{tx.reason}</span>
                      ) : tx.status === "PENDING" && tx.reason ? (
                        <span className="text-rose-400/95 text-xs leading-snug">{tx.reason}</span>
                      ) : tx.status === "PENDING" ? (
                        <span className="text-slate-500 italic">—</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-500 text-sm whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        {tx.time}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      {tx.status === "SUSPICIOUS" ? (
                        <button
                          type="button"
                          onClick={handleBlockAccount}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800/90 text-slate-300 border border-slate-600 hover:bg-red-600 hover:border-red-500 hover:text-white transition-colors"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          {t[lang].blockAccount}
                        </button>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-cyan-500/30 bg-slate-950/95 backdrop-blur-sm overflow-hidden">
        <motion.div
          className="whitespace-nowrap py-1.5 text-[11px] sm:text-xs uppercase tracking-[0.18em] text-cyan-300/90 font-semibold"
          animate={{ x: ["0%", "-50%"] }}
          transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
        >
          [SYSTEM ONLINE] ... [AI ACCURACY: 98.4%] ... [GATEWAY: EVC-PLUS SECURED] ... [OFFICER: ATIKA ALI] ...
          [SYSTEM ONLINE] ... [AI ACCURACY: 98.4%] ... [GATEWAY: EVC-PLUS SECURED] ... [OFFICER: ATIKA ALI] ...
        </motion.div>
      </div>
    </div>
  );
}
