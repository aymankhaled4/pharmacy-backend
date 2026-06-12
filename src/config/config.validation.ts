import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),

  PORT: Joi.number().default(3000),

  SUPABASE_URL: Joi.string().uri().required(),
  SUPABASE_ANON_KEY: Joi.string().required(),
  SUPABASE_SERVICE_ROLE_KEY: Joi.string().required(),
  SUPABASE_JWT_SECRET: Joi.string().required(),
  SUPABASE_WEBHOOK_SECRET: Joi.string().required(),

  OPENAI_API_KEY: Joi.string().optional(),
  OPENAI_MODEL: Joi.string().default('gpt-4o'),

  FIREBASE_SERVICE_ACCOUNT: Joi.string().optional(),

  REDIS_URL: Joi.string().uri().optional().default('redis://localhost:6379'),

  CORS_ORIGINS: Joi.string().required(),
});
