import { Injectable } from '@nestjs/common';

export interface TransactionDto {
  id: string;
  service: string;
  amount: string;
  risk_score: number; // 0–1 or 0–100: high = SUSPICIOUS, low = SAFE
  time: string;
  reason?: string | null;
}

@Injectable()
export class TransactionsService {
  getTransactions(): TransactionDto[] {
    return [
      { id: '1', service: 'EVC Plus', amount: '$450.00', risk_score: 0.12, time: '2 min ago', reason: null },
      {
        id: '2',
        service: 'Sahal',
        amount: '$1,200.00',
        risk_score: 0.89,
        time: '5 min ago',
        reason: 'Exceeded Sahal Limit',
      },
      { id: '3', service: 'EVC Plus', amount: '$85.50', risk_score: 0.05, time: '8 min ago', reason: null },
      {
        id: '4',
        service: 'Sahal',
        amount: '$2,340.00',
        risk_score: 0.92,
        time: '12 min ago',
        reason: 'Pattern Anomaly',
      },
      { id: '5', service: 'EVC Plus', amount: '$120.00', risk_score: 0.18, time: '15 min ago', reason: null },
    ];
  }
}
