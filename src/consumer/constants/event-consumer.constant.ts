export const EVENT_CONSUMER = {
  retryBaseDelayMs: 1000,
  retryMaxDelayMs: 30_000,
  // El coordinador del group puede no estar listo al arrancar: el primer uso de un group responde NOT_COORDINATOR.
  clientRetries: 10,
  clientRetryDelayMs: 1000,
  // Tope total para conectarse al arrancar: después sale con 1 y el CrashLoopBackOff decide cuándo reintentar.
  startupTimeoutMs: 120_000,
  startupRetryDelayMs: 2000,
  // Errores de certificado: reintentarlos no cambia nada, así que el arranque falla en el primer intento.
  // ERR_TLS_HANDSHAKE_TIMEOUT queda afuera a propósito: es un timeout, no un certificado.
  certificateErrorCodes: [
    /^ERR_TLS_(?!HANDSHAKE_TIMEOUT$)/,
    /CERT/,
    /^UNABLE_TO_VERIFY_LEAF_SIGNATURE$/,
    /UNKNOWN_CA$/,
  ],
} as const;
