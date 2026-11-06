export const EVENT_CONSUMER = {
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 30_000,
  // El coordinador del group puede no estar listo al arrancar: el primer uso de un group responde NOT_COORDINATOR.
  clientRetries: 10,
  clientRetryDelayMs: 1000,
} as const;
