CREATE TABLE event (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    source VARCHAR(50) NOT NULL,
    type VARCHAR(100) NOT NULL,
    payload TEXT NOT NULL,
    occurred_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX ix_event_source_created_at ON event (source, created_at);
