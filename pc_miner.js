const { Worker, isMainThread, parentPort } = require('worker_threads');
const crypto = require('crypto');
const os = require('os');
const readline = require('readline');

const API_BASE = 'https://api.rpow2.com';

function trailingZeroBits(buf) {
  let count = 0;
  for (let i = buf.length - 1; i >= 0; i--) {
    const b = buf[i];
    if (b === 0) { count += 8; continue; }
    let bit = 0;
    while ((b & (1 << bit)) === 0) bit++;
    return count + bit;
  }
  return count;
}

if (!isMainThread) {
  // --- WORKER THREAD ---
  parentPort.on('message', (msg) => {
    if (msg.type === 'mine') {
      const { prefixHex, target, workerId, numWorkers } = msg;
      const prefix = Buffer.from(prefixHex, 'hex');
      const buf = Buffer.alloc(prefix.length + 8);
      prefix.copy(buf, 0);

      let nonce = BigInt(workerId);
      let step = BigInt(numWorkers);
      let count = 0;
      let lastReport = Date.now();

      while (true) {
        let x = nonce;
        for (let i = 0; i < 8; i++) {
          buf[prefix.length + i] = Number(x & 0xffn);
          x >>= 8n;
        }

        const digest = crypto.createHash('sha256').update(buf).digest();
        if (trailingZeroBits(digest) >= target) {
          parentPort.postMessage({ type: 'found', nonce: nonce.toString() });
          return;
        }

        nonce += step;
        count++;

        if (count % 50000 === 0) {
          const now = Date.now();
          if (now - lastReport > 1000) {
            parentPort.postMessage({ type: 'progress', hashes: count });
            count = 0;
            lastReport = now;
          }
        }
      }
    }
  });
} else {
  // --- MAIN THREAD ---
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const numWorkers = os.cpus().length;
  let sessionCookie = '';

  async function ask(q) {
    return new Promise(resolve => rl.question(q, resolve));
  }

  let sessionMinted = 0;
  let lastTokenId = '';
  let dashboardTimer = null;

  async function apiFetch(method, path, body = null, extraHeaders = {}) {
    const options = {
      method,
      headers: { ...extraHeaders }
    };
    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    if (sessionCookie) {
      options.headers['Cookie'] = sessionCookie;
    }
    const res = await fetch(API_BASE + path, options);
    return res;
  }

  async function login() {
    console.clear();
    console.log("=== rpow2 PC Miner ===");
    const email = await ask("Enter your email to login: ");

    console.log("Requesting magic link...");
    const reqRes = await apiFetch('POST', '/auth/request', { email });
    if (!reqRes.ok) {
      console.error("Failed to request magic link:", await reqRes.text());
      process.exit(1);
    }

    console.log("\nMagic link sent! Please check your email.");
    const link = await ask("Paste the magic link here: ");
    const tokenMatch = link.match(/token=([^&]+)/);
    if (!tokenMatch) {
      console.error("Could not find token in the link.");
      process.exit(1);
    }

    console.log("Verifying token...");
    const verifyRes = await fetch(API_BASE + `/auth/verify?token=${tokenMatch[1]}`, { redirect: 'manual' });
    const setCookie = verifyRes.headers.get('set-cookie');
    if (!setCookie) {
      console.error("Failed to login, no session cookie returned.");
      process.exit(1);
    }

    const match = setCookie.match(/rpow_session=([^;]+)/);
    if (!match) {
      console.error("Failed to find rpow_session cookie.");
      process.exit(1);
    }
    sessionCookie = `rpow_session=${match[1]}`;
    console.clear();
  }

  let currentTarget = '--';
  let currentHashes = 0;
  let currentElapsedMs = 0;
  let currentRate = '0.00';
  let currentStatus = 'IDLE';
  let currentWallet = null;

  async function updateWallet() {
    try {
      const res = await apiFetch('GET', '/me');
      if (res.ok) {
        currentWallet = await res.json();
      }
    } catch (e) {}
  }

  function renderDashboard() {
    // Move cursor to top-left and clear screen below
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);

    const s = Math.floor(currentElapsedMs / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    const elapsedStr = `00:${mm}:${ss}`;

    const walletStr = currentWallet ? `
+-- WALLET ---------------------------------------

  LOGGED IN AS : ${currentWallet.email}
  BALANCE      : ${String(currentWallet.balance).padStart(4, '0')} RPOW
  MINTED       : ${String(currentWallet.minted).padStart(4, '0')}
  SENT         : ${String(currentWallet.sent).padStart(4, '0')}
  RECEIVED     : ${String(currentWallet.received).padStart(4, '0')}
` : '';

    const out = `${walletStr}
+-- MINE (Node.js x${numWorkers} Threads) ------------------------

  TARGET           : ${currentTarget} trailing zero bits
  HASHES (current) : ${Number(currentHashes).toLocaleString()}
  RATE             : ${currentRate} MH/s
  ELAPSED          : ${elapsedStr}
  STATUS           : ${currentStatus}
  MINED THIS RUN   : ${sessionMinted}
  LAST TOKEN       : ${lastTokenId || '--'}

---------------------------------------------------
Press Ctrl+C to stop
`;
    process.stdout.write(out);
  }

  async function mineLoop() {
    process.stdout.write('\x1B[?25l'); // Hide cursor
    setInterval(renderDashboard, 250); // Redraw dashboard every 250ms

    while (true) {
      currentStatus = 'FETCHING CHALLENGE...';
      const chRes = await apiFetch('POST', '/challenge');
      if (!chRes.ok) {
        currentStatus = `ERROR: ${await chRes.text()}`;
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const ch = await chRes.json();
      currentTarget = ch.difficulty_bits;
      currentStatus = 'MINING';
      currentHashes = 0;
      currentElapsedMs = 0;
      currentRate = '0.00';

      const solutionNonce = await runWorkers(ch.nonce_prefix, ch.difficulty_bits);

      currentStatus = 'SUBMITTING...';
      const mintRes = await apiFetch('POST', '/mint', {
        challenge_id: ch.challenge_id,
        solution_nonce: solutionNonce
      });

      if (mintRes.ok) {
        const data = await mintRes.json();
        sessionMinted++;
        lastTokenId = data.token.id;
        await updateWallet(); // Refresh wallet stats
      } else {
        currentStatus = `MINT FAILED: ${await mintRes.text()}`;
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  function runWorkers(prefixHex, target) {
    return new Promise((resolve) => {
      const workers = [];
      let found = false;
      let totalHashes = 0;
      let startTime = Date.now();

      const cleanup = () => {
        for (const w of workers) w.terminate();
      };

      for (let i = 0; i < numWorkers; i++) {
        const worker = new Worker(__filename);
        workers.push(worker);
        worker.on('message', (msg) => {
          if (found) return;
          if (msg.type === 'found') {
            found = true;
            cleanup();
            resolve(msg.nonce);
          } else if (msg.type === 'progress') {
            totalHashes += msg.hashes;
            const elapsedMs = Date.now() - startTime;
            currentHashes = totalHashes;
            currentElapsedMs = elapsedMs;
            if (elapsedMs > 0) {
              currentRate = ((totalHashes / 1e6) / (elapsedMs / 1000)).toFixed(2);
            }
          }
        });
        worker.postMessage({
          type: 'mine',
          prefixHex,
          target,
          workerId: i,
          numWorkers
        });
      }
    });
  }

  (async () => {
    await login();
    await updateWallet();
    await mineLoop();
  })();
}
