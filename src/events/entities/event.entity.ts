import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('event')
@Index('ix_event_source_created_at', ['source', 'createdAt'])
export class EventEntity {
  @PrimaryColumn('varchar', { name: 'id', length: 36 })
  id: string;

  @Column('varchar', { name: 'source', length: 50 })
  source: string;

  @Column('varchar', { name: 'type', length: 100 })
  type: string;

  @Column('simple-json', { name: 'payload' })
  payload: object;

  @Column('datetime', { name: 'occurred_at' })
  occurredAt: Date;

  @Column('datetime', { name: 'created_at', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
