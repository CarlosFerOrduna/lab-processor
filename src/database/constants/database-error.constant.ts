export const DATABASE_ERROR = {
  uniqueViolation: '23505',
  // Solo las clases que causa el dato: 22 (data exception) y 23 (integrity constraint violation).
  poisonSqlStateClasses: ['22', '23'],
} as const;
