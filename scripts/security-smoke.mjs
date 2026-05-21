const baseUrl = process.env.SECURITY_BASE_URL || process.env.VITE_API_URL || 'http://127.0.0.1:4000/api';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  return { status: response.status, body, headers: response.headers };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const checks = [];

checks.push(['health exposes security posture', async () => {
  const result = await request('/health');
  assert(result.status === 200, `health expected 200, got ${result.status}`);
  assert(result.body.security, 'health must include security object');
}]);

checks.push(['unauthenticated API is blocked', async () => {
  const result = await request('/vehiculos');
  assert(result.status === 401, `vehiculos expected 401, got ${result.status}`);
}]);

checks.push(['SQL injection payload does not bypass login', async () => {
  const result = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: "' OR '1'='1",
      password: "' OR '1'='1",
      captchaToken: process.env.SECURITY_CAPTCHA_TOKEN || ''
    })
  });
  assert([401, 403].includes(result.status), `login injection expected 401/403, got ${result.status}`);
}]);

checks.push(['CSRF token endpoint exists', async () => {
  const result = await request('/csrf');
  assert(result.status === 200, `csrf expected 200, got ${result.status}`);
  assert(typeof result.body.csrfToken === 'string', 'csrfToken missing');
}]);

let failures = 0;
for (const [name, check] of checks) {
  try {
    await check();
    console.log(`OK ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

if (failures) process.exitCode = 1;
