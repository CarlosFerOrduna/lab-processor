import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { DataSource } from 'typeorm';

const DATABASE_PING_TIMEOUT_MS = 1000;

@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  /** The process is up. Never depends on the database, so it is safe for a liveness probe. */
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** The service can take traffic: the database answers within the timeout. For a readiness probe. */
  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    const isDatabaseReachable = await this.pingDatabase();
    if (!isDatabaseReachable) {
      throw new ServiceUnavailableException('The database is not reachable');
    }

    return { status: 'ok' };
  }

  private async pingDatabase(): Promise<boolean> {
    const timeout = new AbortController();
    try {
      const outcome = await Promise.race([
        this.dataSource.query('SELECT 1').then(() => 'answered' as const),
        sleep(DATABASE_PING_TIMEOUT_MS, 'timed-out' as const, { signal: timeout.signal }),
      ]);
      return outcome === 'answered';
    } catch {
      return false;
    } finally {
      timeout.abort();
    }
  }
}
