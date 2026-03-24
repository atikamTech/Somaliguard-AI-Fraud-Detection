import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';

@Injectable()
export class AiEngineService {
  async checkFraud(amount: number, balance: number, hour: number): Promise<string> {
    return new Promise((resolve, reject) => {
      // Points to the Python script in your parent src folder
      const pythonProcess = spawn('python', [
        '../src/predict_single.py',
        amount.toString(),
        balance.toString(),
        hour.toString()
      ]);

      pythonProcess.stdout.on('data', (data) => {
        resolve(data.toString().trim());
      });

      pythonProcess.stderr.on('data', (data) => {
        console.error(`Python Error: ${data}`);
        resolve("Error in Prediction");
      });
    });
  }
}