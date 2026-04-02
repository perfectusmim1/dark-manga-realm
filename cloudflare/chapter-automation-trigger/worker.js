const SERVICE_NAME = 'chapter-automation-trigger';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  },
});

const logEvent = (event, payload = {}) => {
  console.log(JSON.stringify({
    service: SERVICE_NAME,
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  }));
};

const invokeRunner = async (env, trigger) => {
  const runnerUrl = `${env.RUNNER_URL || ''}`.trim();
  const runnerToken = `${env.RUNNER_TOKEN || ''}`.trim();

  if (!runnerUrl || !runnerToken) {
    throw new Error('RUNNER_URL veya RUNNER_TOKEN tanımlı değil');
  }

  const startedAt = Date.now();
  const response = await fetch(runnerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${runnerToken}`,
    },
    body: JSON.stringify({
      trigger,
      triggeredAt: new Date().toISOString(),
    }),
  });

  const responseText = await response.text();
  logEvent(response.ok ? 'runner_success' : 'runner_error', {
    trigger,
    status: response.status,
    durationMs: Date.now() - startedAt,
    responseText,
  });

  if (!response.ok) {
    throw new Error(`Runner çağrısı başarısız oldu (${response.status})`);
  }

  return responseText;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET') {
      return jsonResponse({
        ok: true,
        service: SERVICE_NAME,
        cron: '*/5 * * * *',
        runnerConfigured: Boolean(`${env.RUNNER_URL || ''}`.trim()),
        path: url.pathname,
      });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, message: 'Method not allowed' }, 405);
    }

    try {
      const authHeader = request.headers.get('Authorization') || '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      const expectedToken = `${env.RUNNER_TOKEN || ''}`.trim();

      if (!expectedToken || bearerToken !== expectedToken) {
        return jsonResponse({ ok: false, message: 'Unauthorized' }, 401);
      }

      const responseText = await invokeRunner(env, 'manual');
      return jsonResponse({ ok: true, responseText });
    } catch (error) {
      logEvent('manual_trigger_error', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      return jsonResponse({
        ok: false,
        message: error instanceof Error ? error.message : 'Manual trigger başarısız oldu',
      }, 502);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        await invokeRunner(env, `cron:${controller.cron}`);
      } catch (error) {
        logEvent('scheduled_trigger_error', {
          cron: controller.cron,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
        throw error;
      }
    })());
  },
};
