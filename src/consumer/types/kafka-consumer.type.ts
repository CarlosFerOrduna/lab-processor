import type { Consumer } from '@platformatic/kafka';

/** The Kafka consumer as the processor uses it: string keys, values and headers. */
export type KafkaConsumer = Consumer<string, string, string, string>;
