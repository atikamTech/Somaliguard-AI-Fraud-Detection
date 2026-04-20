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
  narrative?: string;
  velocity_multiplier?: number;
  value_jump?: number | null;
  channel_hop_blocked?: boolean;
  behavioral_features?: any;
}

const PYTHON_PREDICT_URL = 'http://127.0.0.1:8000/predict';

@Injectable()
export class FraudService {
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

  async analyzeTransaction(req: Request, body: FraudCheckBody): Promise<FraudCheckResult> {
    const clientKey = this.getClientKey(req);
    const nowEpoch = Math.floor(Date.now() / 1000);

    // AI "thinking" delay for presentation/UI effect
    await this.randomThinkingDelay();

    try {
      // Direct call to the Stateful ML Engine (Python)
      const pythonRes = await fetch(PYTHON_PREDICT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount: body.amount,
          old_balance: body.balance ?? 0,
          hour: body.hour ?? new Date().getHours(),
          service: body.service ?? '',
          timestamp: nowEpoch,
          user_id: clientKey, // Use client IP for stateful cache
        }),
      });

      if (!pythonRes.ok) {
        throw new Error(`ML Engine Error: ${pythonRes.statusText}`);
      }

      const data = await pythonRes.json();

      // Mapping rules: ML engine is now the SOURCE OF TRUTH
      const prediction = data.prediction === 'SAFE' ? 'SAFE' : 'SUSPICIOUS';
      
      return {
        prediction,
        risk_score: data.risk_score, // Expecting 0-100 from Python
        reason: data.reason,
        reasons: data.reasons || [],
        developer: 'Atika Isse Ali',
        status: data.status,
        narrative: data.narrative,
        velocity_multiplier: data.velocity_multiplier,
        value_jump: data.value_jump,
        channel_hop_blocked: data.channel_hop_blocked,
        behavioral_features: data.behavioral_features,
      };
    } catch (err) {
      console.error('FraudService Error:', err);
      // Fallback if ML engine is down
      return {
        prediction: 'SAFE',
        risk_score: 0,
        reason: 'ML Engine Offline',
        reasons: [],
        developer: 'Atika Isse Ali',
        status: 'Error',
      };
    }
  }
}
}
