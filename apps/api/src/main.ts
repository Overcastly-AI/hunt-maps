import 'reflect-metadata';
import { ValidationPipe, Logger } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { InsufficientHaloFilter } from './terrain/insufficient-halo.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // `BaseExceptionFilter` needs the http adapter to fall through to Nest's
  // default handling for everything that is not `InsufficientHaloError` —
  // constructing it here (rather than via `APP_FILTER`) is the documented
  // way to get that reference. See the filter's own doc comment for why this
  // exists: a hunter's client should be able to grey a layer out and say why,
  // not receive a 500 with a stack trace.
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new InsufficientHaloFilter(httpAdapter));

  // `crossOriginEmbedderPolicy` is disabled deliberately: the map client uses
  // SharedArrayBuffer-free workers but loads tile images from the API and the
  // configured DEM origin, and COEP breaks those without buying us anything a
  // strict CSP does not already cover.
  app.use(helmet({ crossOriginEmbedderPolicy: false }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });

  app.setGlobalPrefix('api');

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Ridgeline API')
      .setDescription('Hunting map & terrain analytics service')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Ridgeline API listening on :${port}`);
}

void bootstrap();
