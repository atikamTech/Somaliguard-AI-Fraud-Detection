import { Injectable } from '@nestjs/common';
import { Request } from 'express';

export interface FraudCheckBody {
  amount: number;
  balance: number;
  hour: number;
  service?: string;
}

export interface FraudCheckResult {
  prediction: 'SAFE' | 'SUSPICIOUS';
  risk_score: number;
  reason: string | null;
  reasons: string[];
  developer: string;
  status: string;
}

const VELOCITY_WINDOW_MS = 60_000;
const VELOCITY_THRESHOLD = 3;
const ROUND_LAUNDERING_AMOUNT = 10_000;
const EVC_LIMIT = 500;
const SAHAL_LIMIT = 1000;
const PYTHON_PREDICT_URL = 'http://127.0.0.1:8000/predict';

type PythonPrediction = 'SAFE' | 'SUSPICIOUS';

interface PythonPredictResult {
  prediction?: string;
  reason?: string | null;
  reasons?: string[];
}

@Injectable()
export class FraudService {
  /** Per-client timestamps of recent fraud/check calls (for velocity) */
  private readonly velocityLog = new Map<string, number[]>();

  constructor() {}

  private getClientKey(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }

  /** Random delay 800ms–2500ms to simulate AI “thinking” */
  private randomThinkingDelay(): Promise<void> {
    const ms = 800 + Math.floor(Math.random() * (2500 - 800 + 1));
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private recordAndCheckVelocity(clientKey: string, now: number): boolean {
    const prev = this.velocityLog.get(clientKey) ?? [];
    const recent = [...prev, now].filter((t) => now - t < VELOCITY_WINDOW_MS);
    this.velocityLog.set(clientKey, recent);
    return recent.length >= VELOCITY_THRESHOLD;
  }

  private isNightTime(hour: number): boolean {
    return hour >= 2 && hour < 5;
  }

  private isExactLargeRoundLaunderingAmount(amount: number): boolean {
    return Number.isFinite(amount) && Math.abs(amount - ROUND_LAUNDERING_AMOUNT) < 0.005;
  }

  private normalizeService(service?: string): string {
    return (service ?? '').trim();
  }

  private normalizePythonPrediction(raw: unknown): PythonPrediction | null {
    const value = String(raw ?? '').trim().toUpperCase();
    if (value === 'SUSPICIOUS' || value === 'FRAUD') return 'SUSPICIOUS';
    if (value === 'SAFE') return 'SAFE';
    return null;
  }

  private uniqueReasons(reasons: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const reason of reasons) {
      const cleaned = String(reason ?? '').trim();
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cleaned);
    }
    return out;
  }

  private async callPythonPredict(body: FraudCheckBody): Promise<{
    prediction: PythonPrediction | null;
    reasons: string[];
  }> {
    try {
      const response = await fetch(PYTHON_PREDICT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: body.amount,
          old_balance: body.balance,
          hour: body.hour,
          service: body.service ?? '',
        }),
      });

      if (!response.ok) {
        return { prediction: null, reasons: [] };
      }

      const data = (await response.json()) as PythonPredictResult;
      const prediction = this.normalizePythonPrediction(data?.prediction);
      const reasons: string[] = [];

      if (Array.isArray(data?.reasons)) {
        reasons.push(...data.reasons.map((r) => String(r)));
      }
      if (typeof data?.reason === 'string' && data.reason.trim().length > 0) {
        reasons.push(data.reason);
      }

      return { prediction, reasons: this.uniqueReasons(reasons) };
    } catch {
      return { prediction: null, reasons: [] };
    }
  }

  async analyzeTransaction(req: Request, body: FraudCheckBody): Promise<FraudCheckResult> {
    const clientKey = this.getClientKey(req);
    const now = Date.now();
    const velocityViolation = this.recordAndCheckVelocity(clientKey, now);

    await this.randomThinkingDelay();

    const python = await this.callPythonPredict(body);
    let risk = python.prediction === 'SUSPICIOUS' ? 0.72 : python.prediction === 'SAFE' ? 0.12 : 0.45;

    const reasons: string[] = [...python.reasons];
    const service = this.normalizeService(body.service);

    if (velocityViolation) {
      reasons.push('Potential bot/script attack');
    }

    if (this.isExactLargeRoundLaunderingAmount(body.amount)) {
      reasons.push('Common in money laundering');
    }

    if (service === 'EVC Plus' && body.amount > EVC_LIMIT) {
      reasons.push('Exceeded EVC Limit');
    }
    if (service === 'Sahal' && body.amount > SAHAL_LIMIT) {
      reasons.push('Exceeded Sahal Limit');
    }

    if (this.isNightTime(body.hour)) {
      risk = Math.min(1, risk + 0.3);
    }

    if (velocityViolation) {
      risk = Math.max(risk, 0.95);
    }
    if (this.isExactLargeRoundLaunderingAmount(body.amount)) {
      risk = Math.max(risk, 0.85);
    }
    if (service === 'EVC Plus' && body.amount > EVC_LIMIT) {
      risk = Math.max(risk, 0.88);
    }
    if (service === 'Sahal' && body.amount > SAHAL_LIMIT) {
      risk = Math.max(risk, 0.88);
    }

    risk = Math.min(1, Math.max(0, risk));

    const ruleSuspicious =
      velocityViolation ||
      this.isExactLargeRoundLaunderingAmount(body.amount) ||
      (service === 'EVC Plus' && body.amount > EVC_LIMIT) ||
      (service === 'Sahal' && body.amount > SAHAL_LIMIT);

    const modelSuspicious = python.prediction === 'SUSPICIOUS';
    const scoreSuspicious = risk >= 0.5;

    const suspicious = ruleSuspicious || modelSuspicious || scoreSuspicious;
    const prediction: 'SAFE' | 'SUSPICIOUS' = suspicious ? 'SUSPICIOUS' : 'SAFE';

    const mergedReasons = this.uniqueReasons(reasons);
    let reason: string | null =
      prediction === 'SUSPICIOUS' && mergedReasons.length > 0 ? mergedReasons.join(' · ') : null;
    if (prediction === 'SUSPICIOUS' && !reason) {
      reason = 'Pattern Anomaly';
    }

    return {
      prediction,
      risk_score: Math.round(risk * 1000) / 1000,
      reason,
      reasons: mergedReasons,
      developer: 'Atika Isse Ali',
      status: prediction,
    };
  }
}
