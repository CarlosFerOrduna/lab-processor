import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('event')
@Index('ix_event_source_created_at', ['source', 'createdAt'])
export class EventEntity {
  @PrimaryColumn('uuid', { name: 'id', primaryKeyConstraintName: 'pk_event' })
  id: string;

  @Column('varchar', { name: 'source', length: 50 })
  source: string;

  @Column('varchar', { name: 'type', length: 100 })
  type: string;

  @Column('jsonb', { name: 'payload' })
  payload: object;

  @Column('timestamptz', { name: 'occurred_at' })
  occurredAt: Date;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
