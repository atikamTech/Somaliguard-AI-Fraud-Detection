import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FraudController } from './fraud/fraud.controller';
import { FraudService } from './fraud/fraud.service';
import { TransactionsController } from './transactions/transactions.controller';
import { TransactionsService } from './transactions/transactions.service';

@Module({
  imports: [],
  controllers: [AppController, FraudController, TransactionsController],
  providers: [AppService, TransactionsService, FraudService],
})
export class AppModule { }