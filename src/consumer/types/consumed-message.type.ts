/** The part of a consumed Kafka message the consumer uses. */
export interface ConsumedMessage {
  topic: string;
  partition: number;
  offset: bigint;
  key: string | null | undefined;
  value: string | null | undefined;
  commit(): void | Promise<void>;
}
