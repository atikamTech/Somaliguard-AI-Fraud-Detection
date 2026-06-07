import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: '*' }); // Allow all for cross-service communication during demo

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Backend Engine is running on port ${port}`);
}
bootstrap();