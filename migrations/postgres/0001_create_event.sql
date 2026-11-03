CREATE TABLE event (
    id uuid NOT NULL,
    source varchar(50) NOT NULL,
    type varchar(100) NOT NULL,
    payload jsonb NOT NULL,
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pk_event PRIMARY KEY (id)
);

CREATE INDEX ix_event_source_created_at ON event (source, created_at);
