import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EnvSchema } from './env.schema';
import { AppConfigService } from './app-config.service';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (env) => {
        const result = EnvSchema.safeParse(env);
        if (!result.success) {
          const msg = result.error.issues
            .map((e) => `  ${e.path.map(String).join('.')}: ${e.message}`)
            .join('\n');
          throw new Error(`❌ Invalid environment configuration:\n${msg}`);
        }
        return result.data;
      },
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
