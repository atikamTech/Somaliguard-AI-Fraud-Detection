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
  Flame,
  Info,
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
  /** Unix epoch seconds — used to detect velocity bursts */
  timestamp?: number;
  reason?: string | null;
  /** All contributing reasons returned by the API */
  reasons?: string[];
  /** 0–100 risk score from the ML engine */
  risk_score?: number;
  /** Behavioral features snapshot */
  behavioral?: {
    time_delta_seconds?: number | null;
    amount_scaling?: number | null;
    is_night_burst?: boolean;
  };
  /** AI narrative explaining the risk decision */
  narrative?: string;
  /** Velocity multiplier applied by the stateful engine */
  velocity_multiplier?: number;
  /** value_jump ratio vs history average */
  value_jump?: number | null;
  /** Whether a channel-hop block was triggered */
  channel_hop_blocked?: boolean;
}

// API response item: backend may send status or risk_score
interface TransactionApiItem {
  id: string;
  service: string;
  amount: string;
  status?: "SAFE" | "SUSPICIOUS" | "PENDING";
  risk_score?: number;
  time: string;
  timestamp?: number;
  reason?: string | null;
  reasons?: string[];
  behavioral_features?: {
    time_delta_seconds?: number | null;
    amount_scaling?: number | null;
    is_night_burst?: boolean;
  };
  narrative?: string;
  velocity_multiplier?: number;
  value_jump?: number | null;
  channel_hop_blocked?: boolean;
}

interface FeedEntry {
  id: string;
  ts: number;          // Date.now()
  tag: "ANALYSIS" | "ACTION" | "CLEAR" | "MONITORING" | "CRITICAL" | "ALERT";
  text: string;
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
    timestamp: item.timestamp,
    reason,
    reasons: item.reasons ?? (reason ? [reason] : []),
    risk_score: item.risk_score,
    behavioral: item.behavioral_features,
    narrative: item.narrative,
    velocity_multiplier: item.velocity_multiplier,
    value_jump: item.value_jump,
    channel_hop_blocked: item.channel_hop_blocked,
  };
}

function mapPredictionToStatus(prediction: string): Transaction["status"] {
  const p = prediction.trim().toUpperCase();
  if (p === "SAFE") return "SAFE";
  if (p === "FRAUD" || p === "SUSPICIOUS") return "SUSPICIOUS";
  return "PENDING";
}

function formatAmountDisplay(amount: number): string {
  return `$${amount.toFixed(2)}`;
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

// ---------------------------------------------------------------------------
// Radial Risk Gauge  —  pulsing SVG circle that speeds up with risk
// ---------------------------------------------------------------------------
function RadialRiskGauge({ score, status }: { score?: number; status: Transaction["status"] }) {
  let displayScore: number;
  if (typeof score === "number") {
    displayScore = Math.min(Math.max(Math.round(score), 0), 100);
  } else {
    displayScore = status === "SUSPICIOUS" ? 75 : status === "SAFE" ? 15 : 50;
  }

  const isGreen  = displayScore < 40;
  const isYellow = displayScore >= 40 && displayScore < 70;

  const color      = isGreen ? "#10b981" : isYellow ? "#f59e0b" : "#f43f5e";
  const glowColor  = isGreen ? "rgba(16,185,129,0.35)" : isYellow ? "rgba(245,158,11,0.35)" : "rgba(244,63,94,0.5)";
  const colorClass = isGreen ? "text-emerald-400" : isYellow ? "text-amber-400" : "text-rose-400";

  // Pulse animation — faster and more intense the higher the score
  const pulseDuration = isGreen ? "3s" : isYellow ? "1.8s" : "0.85s";
  const pulseScale    = isGreen ? 1.04 : isYellow ? 1.08 : 1.15;

  // SVG full circle
  const R   = 22;
  const C   = 2 * Math.PI * R;  // circumference
  const arc = (displayScore / 100) * C;

  return (
    <div className="flex flex-col items-center gap-0.5" title={`Risk score: ${displayScore}/100`}>
      <motion.div
        animate={{ scale: [1, pulseScale, 1] }}
        transition={{ duration: parseFloat(pulseDuration), repeat: Infinity, ease: "easeInOut" }}
        style={{ filter: displayScore >= 40 ? `drop-shadow(0 0 6px ${glowColor})` : undefined }}
      >
        <svg width="52" height="52" viewBox="0 0 52 52" aria-hidden>
          {/* Track ring */}
          <circle cx="26" cy="26" r={R} fill="none" stroke="#1e293b" strokeWidth="5" />
          {/* Filled arc — starts from top (−90 deg) */}
          <circle
            cx="26" cy="26" r={R}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${arc} ${C}`}
            strokeDashoffset={C / 4}  /* rotate start to 12 o'clock */
            style={{ transition: "stroke-dasharray 0.7s ease" }}
          />
          {/* Center label */}
          <text
            x="26" y="30"
            textAnchor="middle"
            fontSize="10"
            fontWeight="bold"
            fill={color}
            fontFamily="'JetBrains Mono', monospace"
          >
            {displayScore}%
          </text>
        </svg>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contributing Factors Tooltip shown on Reason hover
// ---------------------------------------------------------------------------
function ContributingFactorsTooltip({ reasons, children }: { reasons: string[]; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const hasFactors = reasons.length > 1;

  if (!hasFactors) return <>{children}</>;

  return (
    <span
      className="relative inline-flex items-start gap-1 group cursor-help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
      role="button"
      aria-expanded={open}
      aria-label="Show contributing factors"
    >
      {children}
      <Info className="w-3 h-3 mt-0.5 shrink-0 text-rose-300/60 group-hover:text-rose-300 transition-colors" />
      {open && (
        <span
          className="
            absolute z-50 bottom-full left-0 mb-2
            w-64 rounded-xl border border-rose-500/30
            bg-slate-900/95 backdrop-blur-sm
            px-4 py-3 shadow-2xl shadow-black/60
            text-left pointer-events-none
          "
        >
          <span className="block text-[10px] font-bold uppercase tracking-widest text-rose-400/80 mb-2">
            Contributing Factors
          </span>
          <ul className="space-y-1">
            {reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-slate-200 leading-snug">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
                {r}
              </li>
            ))}
          </ul>
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Velocity Pulse icon — flags rapid successive transactions
// ---------------------------------------------------------------------------
function VelocityPulseIcon({ timeDeltaSeconds }: { timeDeltaSeconds?: number | null }) {
  if (timeDeltaSeconds === undefined || timeDeltaSeconds === null) return null;
  if (timeDeltaSeconds >= 300) return null; // > 5 min — no flag

  const isExtreme = timeDeltaSeconds < 60;
  return (
    <span
      title={`Velocity burst: ${Math.round(timeDeltaSeconds)}s since last transaction`}
      className="inline-flex items-center"
    >
      <Flame
        className={`w-3.5 h-3.5 ${
          isExtreme
            ? "text-orange-400 drop-shadow-[0_0_5px_rgba(251,146,60,0.8)] animate-pulse"
            : "text-amber-400/80"
        }`}
      />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Demo Simulation Center — targeted scenarios for Hormuud Demo
// ---------------------------------------------------------------------------
function SimulationPanel({
  onSimulate,
  isBusy,
  isDemoMode,
  toggleDemoMode,
}: {
  onSimulate: (amount: number, service: string, hour?: number, location?: string, device_id?: string) => Promise<void>;
  isBusy: boolean;
  isDemoMode: boolean;
  toggleDemoMode: () => void;
}) {
  const [activeStep, setActiveStep] = useState<string>("");

  const runNormal = async () => {
    const randomAmount = Math.floor(Math.random() * (150 - 10 + 1)) + 10;
    setActiveStep(`Normal Business ($${randomAmount} at 2:00 PM)`);
    await onSimulate(randomAmount, "EVC Plus", 14, "Mogadishu", "Atika_iPhone_15");
    setActiveStep("");
  };

  const runDrain = async () => {
    setActiveStep("Step 1: Probe ($5)");
    await onSimulate(5, "EVC Plus", undefined, "Remote_IP_77.1.0.x", "Linux_Emulator_v4");
    
    // Wait 2 seconds
    setActiveStep("Step 2: Waiting 2 seconds...");
    await new Promise((r) => setTimeout(r, 2000));
    
    setActiveStep("Step 3: Strike ($2,500)");
    await onSimulate(2500, "EVC Plus", undefined, "Remote_IP_77.1.0.x", "Linux_Emulator_v4");
    setActiveStep("");
  };

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl border border-blue-500/30 bg-slate-900/50 mt-4 shadow-inner shadow-blue-500/10">
      <div className="flex justify-between items-center mb-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Demo Simulation Center</p>
        <button
          onClick={toggleDemoMode}
          className={`text-[10px] px-2 py-1 rounded border font-bold transition-colors ${
            isDemoMode ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50" : "bg-slate-700/50 text-slate-400 border-slate-600/50 hover:bg-slate-700"
          }`}
        >
          {isDemoMode ? "AUTO: ON" : "AUTO: OFF"}
        </button>
      </div>
      <div className="flex flex-col gap-3">
        <button
          onClick={runNormal}
          disabled={isBusy}
          className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-bold hover:bg-emerald-500/20 transition-all disabled:opacity-50"
        >
          <UserCircle className="w-4 h-4" />
          Simulate Normal Business
        </button>
        <button
          onClick={runDrain}
          disabled={isBusy}
          className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-bold hover:bg-rose-500/20 transition-all disabled:opacity-50"
        >
          <Fingerprint className="w-4 h-4" />
          Simulate Account Drain
        </button>
      </div>
      {activeStep && <p className="text-xs text-center text-slate-400 font-mono animate-pulse">{activeStep}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lockdown Modal
// ---------------------------------------------------------------------------
function LockdownModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="max-w-md w-full rounded-2xl border-2 border-rose-500 bg-slate-900 p-8 text-center shadow-[0_0_60px_rgba(244,63,94,0.4)]"
      >
        <div className="flex justify-center mb-6">
          <div className="p-4 rounded-full bg-rose-500/20 border border-rose-500/40">
            <Ban className="w-12 h-12 text-rose-500 animate-pulse" />
          </div>
        </div>
        <h2 className="text-3xl font-black text-rose-500 tracking-tighter uppercase mb-4">SYSTEM LOCKDOWN</h2>
        <p className="text-lg font-bold text-white mb-2">FRAUDULENT PATTERN NEUTRALIZED</p>
        <p className="text-slate-400 text-sm mb-8 leading-relaxed">
          The autonomous defense engine has detected a high-speed strike pattern. All related payment channels have been terminated.
        </p>
        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-rose-600 text-white font-black hover:bg-rose-700 transition-colors uppercase tracking-widest text-xs"
        >
          Resume Surveillance
        </button>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Intelligence Feed  —  scrolling terminal of AI "thoughts"
// ---------------------------------------------------------------------------
const TAG_STYLES: Record<FeedEntry["tag"], string> = {
  CRITICAL:   "text-rose-400 font-black",
  ALERT:      "text-orange-400 font-bold",
  ACTION:     "text-amber-300 font-bold",
  ANALYSIS:   "text-cyan-300 font-semibold",
  MONITORING: "text-sky-400",
  CLEAR:      "text-emerald-400",
};

function parseFeedTag(narrative: string): FeedEntry["tag"] {
  if (narrative.includes("[CRITICAL]")) return "CRITICAL";
  if (narrative.includes("[ALERT]"))    return "ALERT";
  if (narrative.includes("[ACTION]"))   return "ACTION";
  if (narrative.includes("[MONITORING]")) return "MONITORING";
  if (narrative.includes("[CLEAR]"))    return "CLEAR";
  return "ANALYSIS";
}

function stripTag(text: string): string {
  return text.replace(/^\[(CRITICAL|ALERT|ACTION|ANALYSIS|MONITORING|CLEAR)\]\s*/, "");
}

function IntelligenceFeed({ entries }: { entries: FeedEntry[] }) {
  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-cyan-500/20 bg-slate-950/60">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
        </span>
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-300/80">
          AI Intelligence Feed
        </p>
        <span className="ml-auto text-[10px] text-slate-600 font-mono">
          {entries.length} events
        </span>
      </div>
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto overscroll-contain space-y-0 font-mono text-[11px] leading-relaxed"
        style={{ maxHeight: "340px" }}
      >
        {entries.length === 0 && (
          <p className="px-4 py-6 text-slate-600 italic text-center">Awaiting transaction data...</p>
        )}
        {entries.map((entry) => {
          const tagStyle = TAG_STYLES[entry.tag];
          const hhmm = new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
          return (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex gap-2 px-4 py-1.5 border-b border-slate-800/50 ${
                entry.tag === "CRITICAL" ? "bg-rose-950/30" :
                entry.tag === "ALERT"    ? "bg-orange-950/20" :
                entry.tag === "ACTION"   ? "bg-amber-950/15" : ""
              }`}
            >
              <span className="shrink-0 text-slate-600 text-[10px] mt-0.5">{hhmm}</span>
              <span>
                <span className={`${tagStyle} mr-1`}>[{entry.tag}]</span>
                <span className="text-slate-300">{stripTag(entry.text)}</span>
              </span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default function SomaliGuardDashboard() {
  const [lang, setLang] = useState<Lang>("EN");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [intelligenceFeed, setIntelligenceFeed] = useState<FeedEntry[]>([]);
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
  const [threatLevel, setThreatLevel] = useState(0); // 0-100 current risk
  const [showLockdown, setShowLockdown] = useState(false);

  const pushFeedEntry = (narrative: string) => {
    const tag = parseFeedTag(narrative);
    setIntelligenceFeed((prev) => [
      ...prev,
      { id: `feed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now(), tag, text: narrative },
    ].slice(-120)); // keep last 120 entries
  };

  const FRAUD_CHECK_URL = process.env.NEXT_PUBLIC_ML_ENGINE_URL || "http://localhost:8000/predict";

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
        const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001"}/transactions`);
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
    const demoNarratives = [
      "[ANALYSIS] Pattern matches 'Escalated Probe' signature — velocity anomaly detected.",
      "[ACTION] Intercepting high-value transfer to unverified gateway.",
      "[MONITORING] Transaction volume elevated. Secondary verification queued.",
      "[CLEAR] Behavioural profile within normal bounds. No anomalies detected.",
      "[ALERT] Abnormal amount spike detected — 4.2× recent average.",
      "[ANALYSIS] Night-time burst signature matched. Cross-referencing account history.",
      "[CLEAR] Multi-factor check passed. Transaction approved by AI engine.",
      "[ACTION] Velocity multiplier 5.0× engaged — rapid-fire sequence intercepted.",
    ];
    const createMockTransaction = (): Transaction => {
      const service = services[Math.floor(Math.random() * services.length)];
      const isSafe = Math.random() < 0.7;
      const suspicious = !isSafe;
      const amount = isSafe
        ? Number((Math.random() * 145 + 5).toFixed(2))
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
      const riskScore = isSafe
        ? Math.floor(Math.random() * 35)
        : Math.floor(Math.random() * 45 + 55);
      const narrative = demoNarratives[Math.floor(Math.random() * demoNarratives.length)];

      return {
        id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        service,
        amount: formatAmountDisplay(amount),
        status: suspicious ? "SUSPICIOUS" : "SAFE",
        time: "Live Feed",
        reason: suspicious ? reasons[Math.floor(Math.random() * reasons.length)] : "Verified by AI Engine",
        risk_score: riskScore,
        narrative,
      };
    };

    const pushDemoTransaction = () => {
      const mock = createMockTransaction();
      if (mock.status === "SUSPICIOUS") {
        playSound("fraud");
      }
      if (mock.narrative) pushFeedEntry(mock.narrative);
      setTransactions((prev) => [mock, ...prev].slice(0, 50));
    };

    pushDemoTransaction();
    const timer = setInterval(() => {
      pushDemoTransaction();
    }, 1000);

    return () => clearInterval(timer);
  }, [isDemoMode]);

  const handleScan = async (amountOverride?: number, serviceOverride?: string, hourOverride?: number, locationOverride?: string, deviceIdOverride?: string) => {
    playSound("scan");
    const amountToParse = amountOverride !== undefined ? amountOverride.toString() : scanAmount;
    const amountNum = parseFloat(amountToParse);
    const trimmed = amountToParse.trim();
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
          service: serviceOverride || scanService,
          hour: hourOverride !== undefined ? hourOverride : new Date().getHours(),
          old_balance: 10000,
          timestamp: Date.now() / 1000,
          location: locationOverride || "Mogadishu",
          device_id: deviceIdOverride || "Unknown",
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

      const resolvedReason: string | null = (data as { reason?: string | null }).reason ?? (status === "SUSPICIOUS" ? "Pattern Anomaly" : null);
      const resolvedReasons: string[] = (data as { reasons?: string[] }).reasons ?? (resolvedReason ? [resolvedReason] : []);
      const resolvedRiskScore: number | undefined = (data as { risk_score?: number }).risk_score;
      const resolvedBehavioral = (data as { behavioral_features?: Transaction["behavioral"] }).behavioral_features;
      const resolvedNarrative: string | undefined = (data as { narrative?: string }).narrative;
      const resolvedVelocity: number | undefined = (data as { velocity_multiplier?: number }).velocity_multiplier;
      const resolvedValueJump: number | null | undefined = (data as { value_jump?: number | null }).value_jump;
      const resolvedChannelHop: boolean = (data as { channel_hop_blocked?: boolean }).channel_hop_blocked ?? false;
      const resolvedLocation: string = locationOverride || "Mogadishu";
      const resolvedDeviceId: string = deviceIdOverride || "Unknown";

      if (resolvedNarrative) pushFeedEntry(resolvedNarrative);
      if (resolvedRiskScore !== undefined) setThreatLevel(resolvedRiskScore);

      if (resolvedRiskScore && resolvedRiskScore >= 95) {
        setShowLockdown(true);
        playSound("block");
      }

      setTransactions((prev) =>
        prev.map((tx) =>
          tx.id === pendingId
            ? {
                ...tx,
                service: serviceOverride || scanService,
                amount: formatAmountDisplay(amountNum),
                status,
                reason: resolvedReason,
                reasons: resolvedReasons,
                risk_score: resolvedRiskScore,
                behavioral: resolvedBehavioral,
                timestamp: Date.now() / 1000,
                narrative: resolvedNarrative,
                velocity_multiplier: resolvedVelocity,
                value_jump: resolvedValueJump,
                channel_hop_blocked: resolvedChannelHop,
                location: resolvedLocation,
                device_id: resolvedDeviceId,
              }
            : tx
        )
      );
    } catch (err) {
      // ... existing error handler
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

      setTransactions((prev) => prev.filter((tx) => tx.id !== pendingId));
      window.alert(`Scan Failed: ${reasonForRow}`);
    } finally {
      setScanning(false);
      setPendingScanId(null);
    }
  };

  const handleManualSimulate = async (amount: number, service: string, hour?: number, location?: string, device_id?: string) => {
    // Helper to call handleScan with overrides
    setScanAmount(amount.toString());
    setScanService(service);
    await handleScan(amount, service, hour, location, device_id);
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
    <div className={`min-h-screen bg-slate-950 text-slate-100 transition-all duration-700 ${(threatLevel >= 98 || threatLevel > 80) ? "critical-alert-pulse" : ""}`}>
      <LockdownModal isOpen={showLockdown} onClose={() => { setShowLockdown(false); setThreatLevel(0); }} />
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

      {/* Header Authority */}
      <div className="w-full bg-black/95 border-b border-slate-900 py-3 px-6 flex items-center justify-center relative z-50 shadow-lg gap-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
        </span>
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-400/90 font-terminal hidden sm:inline">
          LIVE
        </span>
        <span className="text-[11px] sm:text-xs font-bold tracking-[0.15em] uppercase text-slate-200 drop-shadow-[0_0_12px_rgba(255,255,255,0.15)] text-center border-l border-slate-700 pl-3">
          Officer Atika Ali - Central Security Division
        </span>
      </div>

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
                onClick={() => handleScan()}
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
              <SimulationPanel 
                onSimulate={handleManualSimulate} 
                isBusy={scanning} 
                isDemoMode={isDemoMode}
                toggleDemoMode={() => setIsDemoMode((prev) => !prev)}
              />
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

        {/* Live Security Log + Intelligence Feed side-by-side */}
        <div className="mt-8 grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start">

          {/* Live Security Log table */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 backdrop-blur overflow-hidden ring-1 ring-slate-700/50 shadow-2xl shadow-black/20 relative">
          <motion.div 
            initial={{ left: "-30%" }} 
            animate={{ left: "100%" }} 
            transition={{ repeat: Infinity, duration: 2.5, ease: "linear" }} 
            className="absolute top-0 h-[3px] w-[30%] bg-emerald-400 shadow-[0_0_15px_3px_rgba(52,211,153,0.8)] z-10" 
          />
          <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-indigo-900 px-6 py-4 border-b border-slate-700/50 flex flex-wrap items-center gap-3 relative z-0">
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
                    Risk Score
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Contributing Factors
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
                {transactions.map((tx, idx) => {
                  // Compute velocity delta vs the previous entry in the list
                  const prevTx = transactions[idx + 1];
                  const velocityDelta: number | null =
                    tx.behavioral?.time_delta_seconds !== undefined && tx.behavioral.time_delta_seconds !== null
                      ? tx.behavioral.time_delta_seconds
                      : tx.timestamp && prevTx?.timestamp
                      ? tx.timestamp - prevTx.timestamp
                      : null;
                  const allReasons: string[] = tx.reasons && tx.reasons.length > 0
                    ? tx.reasons
                    : tx.reason
                    ? [tx.reason]
                    : [];

                  const score = tx.risk_score ?? 0;
                  const dynamicNarrative = score > 90
                    ? "[ACTION] Velocity multiplier engaged — rapid-fire sequence intercepted."
                    : score > 70
                    ? "[ALERT] Abnormal amount spike detected — 4.2x recent average."
                    : score > 40
                    ? "[ANALYSIS] Night-time burst signature matched."
                    : "[CLEAR] Behavioural profile within normal bounds.";
                  const isHighRisk = score > 70;

                  return (
                  <tr
                    key={tx.id}
                    className={`hover:bg-slate-800/30 transition-colors ${
                      isHighRisk || isCriticalTransaction(tx)
                        ? "bg-rose-950/40 ring-1 ring-inset ring-rose-500/60 shadow-[0_0_15px_rgba(220,38,38,0.5),inset_0_0_20px_rgba(244,63,94,0.3)] critical-flicker"
                        : ""
                    } ${
                      scanning && pendingScanId === tx.id ? "animate-scan-row-pulse" : ""
                    }`}
                  >
                    {/* Service + Velocity + Context */}
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="inline-flex items-center gap-2">
                          <span className="font-medium text-slate-200">{tx.service}</span>
                          <VelocityPulseIcon timeDeltaSeconds={velocityDelta} />
                        </span>
                        {(tx.device_id || tx.location) && (
                          <span className="text-[10px] text-slate-500 mt-1 uppercase tracking-wider">
                            via {tx.device_id || "Unknown"} • {tx.location || "Unknown"}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-6 py-4 text-slate-300 font-terminal text-sm tracking-wide">{tx.amount}</td>

                    {/* Risk Gauge — pulsing radial */}
                    <td className="px-6 py-4">
                      {tx.status === "PENDING" ? (
                        <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border bg-amber-500/15 text-amber-400 border-amber-500/30">
                          {getStatusLabel(tx.status)}
                        </span>
                      ) : (
                        <RadialRiskGauge score={tx.risk_score} status={tx.status} />
                      )}
                    </td>

                    <td className="px-6 py-4 text-slate-400 text-sm max-w-xs">
                      {tx.status === "PENDING" ? (
                        <span className="text-slate-500 italic">—</span>
                      ) : (
                        <ContributingFactorsTooltip reasons={[dynamicNarrative, ...allReasons.filter(r => r !== tx.narrative && r !== tx.reason)]}>
                          <span
                            className={
                              isHighRisk
                                ? "font-bold text-rose-400 drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]"
                                : score > 40
                                ? "font-bold text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]"
                                : "text-emerald-300/90"
                            }
                          >
                            {dynamicNarrative}
                          </span>
                        </ContributingFactorsTooltip>
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
                  );
                })}
              </tbody>
            </table>
          </div>
          </div>  {/* end table card */}

          {/* Intelligence Feed panel */}
          <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/80 backdrop-blur overflow-hidden ring-1 ring-cyan-500/10 shadow-2xl shadow-black/20 flex flex-col" style={{ minHeight: "420px" }}>
            <IntelligenceFeed entries={intelligenceFeed} />
          </div>

        </div>  {/* end grid */}
      </main>
    </div>
  );
}
