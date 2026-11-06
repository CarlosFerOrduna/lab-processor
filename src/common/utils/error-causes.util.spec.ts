import { ErrorCausesUtil } from './error-causes.util';

function codedError(code: string, message: string, cause?: unknown): Error {
  return Object.assign(new Error(message, { cause }), { code });
}

describe('ErrorCausesUtil.describe', () => {
  it('reaches the TLS error nested inside the Kafka client errors', () => {
    const tls = codedError('ERR_TLS_CERT_ALTNAME_INVALID', "Hostname/IP does not match certificate's altnames");
    const network = codedError('PLT_KFK_NETWORK', 'Connection to 10.42.0.99:9093 failed.', tls);
    const brokers = new AggregateError([network], 'Cannot connect to any broker.');
    const joinGroup = new AggregateError([brokers, brokers], 'joinGroup failed 2 times.');

    const description = ErrorCausesUtil.describe(joinGroup);

    expect(description).toBe(
      "AggregateError: joinGroup failed 2 times. <- Error[ERR_TLS_CERT_ALTNAME_INVALID]: Hostname/IP does not match certificate's altnames",
    );
  });

  it('lists each distinct root cause once', () => {
    const refused = codedError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:9');
    const timedOut = codedError('ETIMEDOUT', 'connect ETIMEDOUT');

    const description = ErrorCausesUtil.describe(new AggregateError([refused, timedOut, refused], 'failed 3 times.'));

    expect(description).toBe(
      'AggregateError: failed 3 times. <- Error[ECONNREFUSED]: connect ECONNREFUSED 127.0.0.1:9 | Error[ETIMEDOUT]: connect ETIMEDOUT',
    );
  });

  it('describes an error without causes by itself', () => {
    expect(ErrorCausesUtil.describe(new TypeError('boom'))).toBe('TypeError: boom');
  });

  it('describes a value that is not an error', () => {
    expect(ErrorCausesUtil.describe('closed')).toBe('closed');
  });
});
