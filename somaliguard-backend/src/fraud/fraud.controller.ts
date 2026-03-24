import { Controller, Post, Body, Req, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { FraudService } from './fraud.service';
import type { FraudCheckBody } from './fraud.service';

/** Must match frontend JSON body: { amount, service } */
export interface FraudCheckRequestDto {
    amount: number;
    service: string;
}

@Controller('fraud')
export class FraudController {
    constructor(private readonly fraudService: FraudService) { }

    @Post('check')
    async verifyTransaction(@Req() req: Request, @Body() body: FraudCheckRequestDto) {
        const amount = Number(body?.amount);
        const service =
            typeof body?.service === 'string' ? body.service.trim() : '';

        if (!Number.isFinite(amount) || amount <= 0) {
            throw new BadRequestException('amount must be a positive number');
        }

        const now = new Date();
        const data: FraudCheckBody = {
            amount,
            balance: 10_000,
            hour: now.getHours(),
            service: service.length > 0 ? service : undefined,
        };

        return this.fraudService.analyzeTransaction(req, data);
    }
}