// -----------------------------------------------------------------------------
// The only network access: one GET of /v1/json, bounded, our error codes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { ReaderClient } from '../src/ecotracker/client.js';
import { REAL_TEXT, SPEC, json } from './fixtures/ecotracker.js';
import { createFetch, refusedError, streamOf, timeoutError } from './helpers/fakeNet.js';

const client = (handler) => {
  const net = createFetch(handler);
  return { net, client: new ReaderClient({ address: '192.168.1.70:8080', fetchImpl: net.fetch }) };
};

const codeOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  assert.fail('expected an error');
};

test('one GET of /v1/json at the address, no redirect followed, a timeout', async () => {
  const { net, client: c } = client(() => json(REAL_TEXT));
  const reading = await c.readData();
  assert.equal(reading.power, -3127);
  assert.equal(net.calls.length, 1);
  assert.equal(net.calls[0].host, '192.168.1.70:8080');
  assert.equal(net.calls[0].path, '/v1/json');
  assert.equal(net.calls[0].init.method, 'GET');
  assert.equal(net.calls[0].init.redirect, 'manual');
  assert.ok(net.calls[0].init.signal instanceof AbortSignal);
  assert.equal(net.calls[0].init.headers['User-Agent'], undefined);
});

test('our error codes, never a text of the reader', async () => {
  const cases = [
    [() => json('everHome Local API secret', { status: 404 }), 'not_found'],
    [() => json('secret text', { status: 403 }), 'http'],
    [() => json('', { status: 302, headers: { location: 'http://elsewhere/' } }), 'http'],
    [() => json('', { status: 500 }), 'server'],
    [() => json('', { status: 429, headers: { 'retry-after': '120' } }), 'rate_limited'],
    [() => json('<html>secret'), 'not_data'],
    [() => json({ hello: 'world' }), 'unknown_answer'],
    [
      () => {
        throw timeoutError();
      },
      'timeout',
    ],
    [
      () => {
        throw refusedError();
      },
      'unreachable',
    ],
  ];
  for (const [handler, code] of cases) {
    const err = await codeOf(client(handler).client.readData());
    assert.equal(err.code, code);
    assert.ok(!/secret|html|elsewhere|everHome/.test(err.message), err.message);
  }
  const limited = await codeOf(
    client(() => json('', { status: 429, headers: { 'retry-after': '120' } })).client.readData(),
  );
  assert.equal(limited.retryAfter, 120_000);
});

test('a hostile answer is cut at 16 KiB', async () => {
  const err = await codeOf(
    client(() => new Response(streamOf(10_000, 1024), { status: 200 })).client.readData(),
  );
  assert.equal(err.code, 'too_large');
});

test('one request at a time', async () => {
  const { net, client: c } = client(() => json(SPEC));
  net.hold = true;
  const a = c.readData();
  const b = c.readData();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(net.calls.length, 1);
  net.hold = false;
  net.release();
  await a;
  await b;
  assert.equal(net.calls.length, 2);
});

// --- Against real local HTTP servers (Node's own fetch) --------------------------------

async function serve(handler) {
  let connections = 0;
  const server = createServer(handler);
  server.on('connection', () => {
    connections += 1;
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    address: `127.0.0.1:${server.address().port}`,
    connections: () => connections,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

test('real server: the answer of a reader, pretty-printed with tabs', async () => {
  const srv = await serve((req, res) => {
    assert.equal(req.url, '/v1/json');
    assert.equal(req.method, 'GET');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(REAL_TEXT);
  });
  try {
    const reading = await new ReaderClient({ address: srv.address }).readData();
    assert.equal(reading.imports.total, 1541.618);
  } finally {
    await srv.close();
  }
});

test('real server: a redirect is never followed', async () => {
  const other = await serve((req, res) => res.end('{"power":1}'));
  const srv = await serve((req, res) => {
    res.writeHead(307, { location: `http://${other.address}/v1/json` });
    res.end();
  });
  try {
    const err = await codeOf(new ReaderClient({ address: srv.address }).readData());
    assert.equal(err.code, 'http');
    assert.equal(other.connections(), 0);
  } finally {
    await srv.close();
    await other.close();
  }
});

test('real server: an endless body and a gzip bomb are cut at 16 KiB', async () => {
  const bomb = gzipSync(Buffer.alloc(20 * 1024 * 1024, 0x20));
  const srv = await serve((req, res) => {
    if (req.headers['accept-encoding']?.includes('gzip') && req.url === '/v1/json') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(bomb);
      return;
    }
    res.end();
  });
  const endless = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    const chunk = Buffer.alloc(4096, 0x20);
    const timer = setInterval(() => res.write(chunk), 1);
    res.on('close', () => clearInterval(timer));
  });
  try {
    assert.equal(
      (await codeOf(new ReaderClient({ address: srv.address }).readData())).code,
      'too_large',
    );
    assert.equal(
      (await codeOf(new ReaderClient({ address: endless.address }).readData())).code,
      'too_large',
    );
  } finally {
    await srv.close();
    await endless.close();
  }
});

test('real server: headers never sent end at the timeout', async () => {
  const srv = await serve(() => {});
  try {
    const started = Date.now();
    const err = await codeOf(new ReaderClient({ address: srv.address, timeout: 200 }).readData());
    assert.equal(err.code, 'timeout');
    assert.ok(Date.now() - started < 5000);
  } finally {
    await srv.close();
  }
});
