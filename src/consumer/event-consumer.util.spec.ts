import { EventConsumerUtil } from './event-consumer.util';

describe('EventConsumerUtil', () => {
  describe('retryDelay', () => {
    it('doubles from one second up to thirty', () => {
      expect([1, 2, 3, 4, 5, 6, 7].map((attempt) => EventConsumerUtil.retryDelay(attempt))).toEqual([
        1000, 2000, 4000, 8000, 16_000, 30_000, 30_000,
      ]);
    });
  });

  describe('isCertificateError', () => {
    function coded(code: string): Error {
      return Object.assign(new Error(code), { code });
    }

    it.each([
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'CERT_HAS_EXPIRED',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'ERR_SSL_SSLV3_ALERT_BAD_CERTIFICATE',
      'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA',
    ])('treats %s, nested in the client errors, as a certificate error', (code) => {
      const nested = new AggregateError([Object.assign(new Error('failed'), { cause: coded(code) })], 'failed');

      expect(EventConsumerUtil.isCertificateError(nested)).toBe(true);
    });

    it.each(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ERR_TLS_HANDSHAKE_TIMEOUT'])('retries %s', (code) => {
      expect(EventConsumerUtil.isCertificateError(new AggregateError([coded(code)], 'failed'))).toBe(false);
    });
  });
});
