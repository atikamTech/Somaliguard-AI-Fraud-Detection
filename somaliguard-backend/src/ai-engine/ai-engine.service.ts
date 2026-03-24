import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import * as path from 'path';

@Injectable()
export class AiEngineService {
    async checkFraud(amount: number, balance: number, hour: number): Promise<string> {
        return new Promise((resolve) => {
            // Find the script in the main src folder
            const scriptPath = path.join(process.cwd(), '..', 'src', 'predict_single.py');

            const pythonProcess = spawn('python', [
                scriptPath,
                amount.toString(),
                balance.toString(),
                hour.toString(),
            ]);

            let result = "";
            pythonProcess.stdout.on('data', (data) => {
                result += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                console.error(`Python Error: ${data}`);
            });

            pythonProcess.on('close', (code) => {
                if (code !== 0 || !result) {
                    resolve("ERROR");
                } else {
                    // Send the clean result (SAFE or FRAUD) back to the frontend
                    resolve(result.trim());
                }
            });
        });
    }
}