import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import fastifyCompress from '@fastify/compress';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { AppConfigService } from '@platform/config';

export async function bootstrapApp(app: NestFastifyApplication): Promise<void> {
  // Pino structured logger
  app.useLogger(app.get(Logger));
  app.flushLogs();

  const config = app.get(AppConfigService);
  const isDev = config.get('NODE_ENV') !== 'production';

  // Register Fastify plugins
  await app.register(fastifyHelmet, {
    // Relax CSP for Swagger UI in dev
    contentSecurityPolicy: isDev ? false : undefined,
  });

  // Response compression — reduces JSON payload size 60-80% (gzip/deflate/brotli)
  await app.register(fastifyCompress, { encodings: ['gzip', 'deflate', 'br'] });

  await app.register(fastifyCookie, {
    secret: config.get('CSRF_SECRET'),
  });

  await app.register(fastifyCsrf, {
    sessionPlugin: '@fastify/cookie',
    cookieOpts: { signed: true },
  });

  // Multipart / file upload — 10 MB limit per file
  await app.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024 /* 10 MB */, files: 1 },
  });

  // CORS
  app.enableCors({
    origin: config
      .get('CORS_ORIGINS')
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Correlation-Id',
      'X-CSRF-Token',
      'Idempotency-Key',
      'traceparent',
      'tracestate',
      'baggage',
    ],
    exposedHeaders: ['X-Correlation-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'Retry-After'],
  });

  // URI versioning: /v1/...
  app.setGlobalPrefix('v1');

  // OpenAPI — only expose in non-prod
  if (isDev) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Rally API')
      .setDescription('Rally SaaS — project management platform API')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addTag('auth', 'Authentication & session management')
      .addTag('workspaces', 'Workspace management')
      .addTag('projects', 'Project management')
      .addTag('work-items', 'Work items (stories, tasks, defects, features)')
      .addTag('health', 'Health & readiness probes')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
        deepLinking: true,
        defaultModelsExpandDepth: 1,
      },
    });
  }

  // Graceful shutdown — ECS SIGTERM drains in-flight requests
  app.enableShutdownHooks();
}
