import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/configuration.js';
import { configureApp } from './setup-app.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false, // configureApp registers a JSON parser with a size limit instead
  });
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);

  configureApp(app);

  // Lets Nest close DB and Redis connections cleanly on SIGTERM (Docker, Kubernetes later)
  app.enableShutdownHooks();

  const port = config.get('app.port', { infer: true });
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
}

void bootstrap();