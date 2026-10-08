import { expectOk, scenario } from '../types';

export const session = [
  scenario('the signed-in person, and signing out', async (api, expect) => {
    // The app asks who is signed in when it starts (api.checkLogin); the email banner reads the
    // same answer.
    const me = await api.get('/api/auth/me');
    expectOk(expect, me, 'GET /api/auth/me');
    // DIFFERENCE auth-local-user
    if (api.runtime === 'worker') {
      expect(me.body).toMatchObject({
        id: expect.any(Number),
        email: expect.any(String),
        auth_provider: 'password',
      });
    } else {
      expect(me.body).toEqual({ id: 1, username: 'local', role: 'admin' });
    }

    // Logout signs this browser out (App.tsx handleLogout), in either mode.
    const out = await api.post('/api/auth/logout');
    expectOk(expect, out, 'POST /api/auth/logout');
    expect(out.body).toEqual({ ok: true });
    // DIFFERENCE auth-local-user: local-first has no session to end.
    expect((await api.get('/api/auth/me')).status).toBe(api.runtime === 'worker' ? 401 : 200);
  }),

  scenario('the health check', async (api, expect) => {
    const reply = await api.get('/api/health');
    expectOk(expect, reply, 'GET /api/health');
    // DIFFERENCE health-answer
    if (api.runtime === 'worker') {
      expect(reply.body).toEqual({ ok: true, env: 'development', captcha: 'disabled' });
    } else {
      expect(reply.body).toEqual({ status: 'ok', timestamp: expect.any(String) });
    }
  }),
];
