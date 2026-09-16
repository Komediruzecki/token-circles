import { sign } from 'hono/jwt';

export class EnableBankingClient {
  private appId: string;
  private privateKey: CryptoKey;

  constructor(appId: string, privateKey: CryptoKey) {
    this.appId = appId;
    this.privateKey = privateKey;
  }

  static async create(appId: string, pemKey: string): Promise<EnableBankingClient> {
    const key = await this.importPEM(pemKey);
    return new EnableBankingClient(appId, key);
  }

  private static async importPEM(pem: string): Promise<CryptoKey> {
    // Strip headers, footers, and newlines
    const pemContents = pem
      .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/, '')
      .replace(/-----END (RSA )?PRIVATE KEY-----/, '')
      .replace(/\s/g, '');

    const binaryDerString = atob(pemContents);
    const binaryDer = new Uint8Array(binaryDerString.length);
    for (let i = 0; i < binaryDerString.length; i++) {
      binaryDer[i] = binaryDerString.charCodeAt(i);
    }

    try {
      // Try PKCS8 first (standard for 'PRIVATE KEY')
      return await crypto.subtle.importKey(
        'pkcs8',
        binaryDer.buffer,
        {
          name: 'RSASSA-PKCS1-v1_5',
          hash: 'SHA-256',
        },
        false,
        ['sign']
      );
    } catch (e) {
      throw new Error(
        `Failed to import private key. Ensure it is in PKCS#8 format. Error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  private async generateJWT(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: 'enablebanking.com',
      aud: 'api.enablebanking.com',
      iat: now,
      exp: now + 3600, // 1 hour TTL
    };

    const header = {
      typ: 'JWT',
      alg: 'RS256',
      kid: this.appId,
    };

    // hono/jwt allows passing a custom header in the third argument, but Wait, sign() signature:
    // sign(payload, secret, alg) -> hono/jwt doesn't let us set 'kid' easily unless we use the expanded signature?
    // Let's check hono/jwt signature if needed, or we can build the JWT manually.
    // We will build the JWT manually if Hono doesn't support setting the kid header easily.
    const encodedHeader = btoa(JSON.stringify(header))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const encodedPayload = btoa(JSON.stringify(payload))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const dataToSign = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);

    const signature = await crypto.subtle.sign(
      { name: 'RSASSA-PKCS1-v1_5' },
      this.privateKey,
      dataToSign
    );

    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
  }

  async getASPSPs(country = 'HR') {
    const jwt = await this.generateJWT();
    const res = await fetch(`https://api.enablebanking.com/aspsps?country=${country}`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Enable Banking API error: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async startAuthorization(aspsp_name: string, redirect_uri: string, state: string) {
    const jwt = await this.generateJWT();

    const body = {
      access: {
        valid_until: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(), // 180 days
      },
      aspsp: {
        name: aspsp_name,
        country: 'HR',
      },
      redirect_url: redirect_uri,
      state: state,
    };

    const res = await fetch(`https://api.enablebanking.com/auth`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Enable Banking Auth error: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async authorizeSession(code: string) {
    const jwt = await this.generateJWT();

    const body = { code };

    const res = await fetch(`https://api.enablebanking.com/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Enable Banking Sessions error: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async getBalances(sessionId: string, accountId: string) {
    const jwt = await this.generateJWT();

    const res = await fetch(`https://api.enablebanking.com/accounts/${accountId}/balances`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Enable Banking Balances error: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }

  async getTransactions(sessionId: string, accountId: string, dateFrom?: string, dateTo?: string) {
    const jwt = await this.generateJWT();

    const params = new URLSearchParams();
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);

    const qs = params.toString() ? `?${params.toString()}` : '';

    const res = await fetch(
      `https://api.enablebanking.com/accounts/${accountId}/transactions${qs}`,
      {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      }
    );

    if (!res.ok) {
      throw new Error(`Enable Banking Transactions error: ${res.status} ${await res.text()}`);
    }
    return res.json();
  }
}
