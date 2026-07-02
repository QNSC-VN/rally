/**
 * pg-connection-string v3 maps sslmode=require to ssl.rejectUnauthorized=true
 * (behaves as verify-full). Alpine containers lack the Amazon RDS CA so the
 * handshake fails with SELF_SIGNED_CERT_IN_CHAIN.
 *
 * Fix: strip sslmode from the URL so pg doesn't get a conflicting ssl config,
 * then pass ssl:{rejectUnauthorized:false} explicitly. SSL is still used
 * (encrypted), CA verification is skipped — acceptable for VPC-internal traffic.
 */
export function pgOptions(url: string): { connectionString: string; ssl?: { rejectUnauthorized: false } } {
  const needsSsl = /sslmode=(require|verify)/.test(url);
  if (!needsSsl) return { connectionString: url };
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } };
  } catch {
    return { connectionString: url, ssl: { rejectUnauthorized: false } };
  }
}
