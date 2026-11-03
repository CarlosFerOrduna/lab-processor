import Joi from 'joi';

/** What the migrations need: only the database connection. */
export const databaseEnvValidationSchema = Joi.object({
  DATABASE_HOST: Joi.string().hostname().required(),
  DATABASE_PORT: Joi.number().port().default(5432),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
});

export const envValidationSchema = databaseEnvValidationSchema.keys({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('production'),
  PORT: Joi.number().port().default(3000),
});
