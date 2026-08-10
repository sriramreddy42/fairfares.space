import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';

const baseUrl = (__ENV.BASE_URL || 'http://127.0.0.1:8120').replace(/\/$/, '');
const profile = (__ENV.PROFILE || 'smoke').toLowerCase();
const password = __ENV.LOAD_PASSWORD || 'FairFaresK6!';
const userPrefix = __ENV.LOAD_USER_PREFIX || 'k6.user';
const isLoopback = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl);
const dangerous = ['high', 'stress', 'spike'].includes(profile);

if (/fairfare\.space/i.test(baseUrl) && __ENV.ALLOW_PRODUCTION_LOAD !== 'YES_I_ACCEPT_THE_RISK') {
  throw new Error('Production load testing is blocked. Use an isolated environment.');
}
if (dangerous && !isLoopback && __ENV.ALLOW_REMOTE_HIGH_LOAD !== 'YES_I_ACCEPT_THE_RISK') {
  throw new Error(`${profile} is blocked against remote hosts without explicit approval.`);
}

const profiles = {
  smoke: [{ duration: '5s', target: 10 }, { duration: '15s', target: 10 }, { duration: '5s', target: 0 }],
  normal: [{ duration: '15s', target: 50 }, { duration: '45s', target: 50 }, { duration: '10s', target: 0 }],
  medium: [{ duration: '20s', target: 250 }, { duration: '60s', target: 250 }, { duration: '15s', target: 0 }],
  high: [{ duration: '30s', target: 500 }, { duration: '90s', target: 500 }, { duration: '20s', target: 0 }],
  stress: [
    { duration: '30s', target: 250 }, { duration: '30s', target: 500 },
    { duration: '45s', target: 1000 }, { duration: '60s', target: 1000 },
    { duration: '30s', target: 0 },
  ],
  spike: [{ duration: '5s', target: 500 }, { duration: '60s', target: 500 }, { duration: '10s', target: 0 }],
};

if (!profiles[profile]) throw new Error(`Unknown PROFILE=${profile}`);

export const options = {
  scenarios: { fairfares: { executor: 'ramping-vus', gracefulRampDown: '10s', stages: profiles[profile] } },
  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    auth_duration: ['p(95)<3000'],
    housing_duration: ['p(95)<1500'],
    carpool_duration: ['p(95)<1500'],
    rentals_duration: ['p(95)<1500'],
    chitthi_duration: ['p(95)<1500'],
  },
};

const authDuration = new Trend('auth_duration', true);
const housingDuration = new Trend('housing_duration', true);
const carpoolDuration = new Trend('carpool_duration', true);
const rentalsDuration = new Trend('rentals_duration', true);
const chitthiDuration = new Trend('chitthi_duration', true);
const journeyFailures = new Rate('journey_failures');
const journeyCount = new Counter('journeys');
let token = '';

function headers() {
  return { Accept: 'application/json', Authorization: `Bearer ${token}` };
}

function request(label, path, trend) {
  const response = http.get(`${baseUrl}${path}`, { headers: headers(), tags: { journey: label } });
  trend.add(response.timings.duration);
  const ok = check(response, { [`${label}: 200`]: (r) => r.status === 200 });
  journeyFailures.add(!ok);
  journeyCount.add(1, { journey: label });
}

function authenticate() {
  if (token) return;
  const id = exec.vu.idInTest;
  const response = http.post(`${baseUrl}/api/mobile/login`, JSON.stringify({
    identifier: `${userPrefix}.${String(id).padStart(4, '0')}@example.test`, password,
  }), { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, tags: { journey: 'auth' } });
  authDuration.add(response.timings.duration);
  const body = response.status === 200 ? response.json() : {};
  const ok = check(response, {
    'auth: 200': (r) => r.status === 200,
    'auth: token returned': () => typeof body.token === 'string' && body.token.length > 10,
  });
  journeyFailures.add(!ok);
  if (!ok) throw new Error(`login failed for VU ${id}: ${response.status}`);
  token = body.token;
}

export default function () {
  authenticate();
  const choice = Math.random();
  if (choice < 0.30) {
    request('housing-search', '/api/mobile/housing?city=Denver%2C%20CO&area=Capitol%20Hill&radius=60&limit=50', housingDuration);
    if (Math.random() < 0.25) request('housing-history', '/api/mobile/housing/activity', housingDuration);
  } else if (choice < 0.55) {
    request('carpool-search', '/api/mobile/rides?city=Denver%2C%20CO&type=CARPOOL_OFFER&origin=Denver%2C%20CO&destination=Colorado%20Springs%2C%20CO', carpoolDuration);
    if (Math.random() < 0.25) request('carpool-history', '/api/mobile/rides/activity', carpoolDuration);
  } else if (choice < 0.72) {
    request('rental-search', '/api/mobile/rentals?location=Denver', rentalsDuration);
    if (Math.random() < 0.25) request('rental-history', '/api/mobile/rentals/bookings', rentalsDuration);
  } else if (choice < 0.92) {
    request('chitthi-inbox', '/api/chat/conversations', chitthiDuration);
    if (Math.random() < 0.50) request('chitthi-communities', '/api/chat/communities?city=Denver%2C%20CO', chitthiDuration);
  } else {
    request('bootstrap', '/api/mobile/bootstrap?city=Denver%2C%20CO', housingDuration);
    request('location-options', '/api/mobile/location-options?city=St.%20Louis%2C%20MO&q=Central', housingDuration);
  }
  sleep(0.6 + Math.random() * 1.8);
}
