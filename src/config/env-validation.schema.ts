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

/** What the Kafka consumer needs: the database, its /health port, and its Kafka client. */
export const consumerEnvValidationSchema = envValidationSchema.keys({
  KAFKA_BOOTSTRAP_BROKERS: Joi.string().required(),
  KAFKA_CLIENT_ID: Joi.string().default('processor-consumer'),
  KAFKA_GROUP_ID: Joi.string().default('processor'),
  KAFKA_TOPICS: Joi.string().required(),
  KAFKA_CA_FILE: Joi.string().required(),
  KAFKA_CERT_FILE: Joi.string().required(),
  KAFKA_KEY_FILE: Joi.string().required(),
});
