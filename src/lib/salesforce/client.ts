/**
 * Salesforce REST API client using OAuth 2.0 Username-Password flow.
 *
 * Required env vars:
 *   SF_LOGIN_URL        – e.g. https://login.salesforce.com
 *   SF_CLIENT_ID        – Connected App consumer key
 *   SF_CLIENT_SECRET    – Connected App consumer secret
 *   SF_USERNAME         – API user email
 *   SF_PASSWORD          – password + security token concatenated
 */

interface TokenResponse {
  access_token: string;
  instance_url: string;
  token_type: string;
}

interface QueryResult<T> {
  totalSize: number;
  done: boolean;
  records: T[];
}

let cached: { token: string; instanceUrl: string; expiresAt: number } | null =
  null;

function getEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

async function authenticate(): Promise<{
  token: string;
  instanceUrl: string;
}> {
  // Reuse token for up to 90 minutes
  if (cached && Date.now() < cached.expiresAt) {
    return { token: cached.token, instanceUrl: cached.instanceUrl };
  }

  const loginUrl = getEnv("SF_LOGIN_URL");
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: getEnv("SF_CLIENT_ID"),
    client_secret: getEnv("SF_CLIENT_SECRET"),
    username: getEnv("SF_USERNAME"),
    password: getEnv("SF_PASSWORD"),
  });

  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce auth failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as TokenResponse;
  cached = {
    token: data.access_token,
    instanceUrl: data.instance_url,
    expiresAt: Date.now() + 90 * 60 * 1000,
  };

  return { token: data.access_token, instanceUrl: data.instance_url };
}

export async function sfQuery<T>(soql: string): Promise<QueryResult<T>> {
  const { token, instanceUrl } = await authenticate();

  const res = await fetch(
    `${instanceUrl}/services/data/v62.0/query?q=${encodeURIComponent(soql)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    // If token expired mid-cache, clear and retry once
    if (res.status === 401 && cached) {
      cached = null;
      return sfQuery(soql);
    }
    throw new Error(`Salesforce query failed (${res.status}): ${text}`);
  }

  return (await res.json()) as QueryResult<T>;
}

/** Returns true if all required SF env vars are set. */
export function isSalesforceConfigured(): boolean {
  return !!(
    process.env.SF_LOGIN_URL &&
    process.env.SF_CLIENT_ID &&
    process.env.SF_CLIENT_SECRET &&
    process.env.SF_USERNAME &&
    process.env.SF_PASSWORD
  );
}
