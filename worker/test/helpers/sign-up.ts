/**
 * An account made the way a person makes one: signing up, then opening the confirm link the
 * welcome mail carries. A password account whose address is not confirmed cannot sign in or use
 * the app, so a test that signs up and then signs in comes through here.
 */
import { env } from 'cloudflare:test';
import { fetchSettled } from './after-answer';

/**
 * Sign up at `base` with `email` and `password`, wait for the account the sign-up writes after its
 * answer, and confirm its address, as opening the link does.
 */
export async function signUpConfirmed(
  base: string,
  email: string,
  password: string
): Promise<void> {
  const res = await fetchSettled(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (res.status !== 200) throw new Error(`signUpConfirmed: sign-up answered ${res.status}`);
  const { meta } = await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE email = ?')
    .bind(email.trim().toLowerCase())
    .run();
  if (meta.changes !== 1) throw new Error(`signUpConfirmed: no account was made for ${email}`);
}
