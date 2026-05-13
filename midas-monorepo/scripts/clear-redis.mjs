/**
 * clear-redis.mjs
 * FLUSHALL на Redis, чтобы очистить все сессии, черновики и FSM-стейты.
 * Run: node scripts/clear-redis.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import net from 'net';

// Простой RESP-клиент без зависимостей — просто шлём FLUSHALL через TCP
const REDIS_HOST = 'switchback.proxy.rlwy.net';
const REDIS_PORT = 51779;
const REDIS_PASSWORD = 'MebxRhXuDJWJmFGxIwASEhjbEYRzQGps';

function sendCommand(...args) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: REDIS_HOST, port: REDIS_PORT });
    socket.setTimeout(10000);

    let resp = '';
    socket.on('connect', () => {
      // AUTH
      const authCmd = `*2\r\n$4\r\nAUTH\r\n$${REDIS_PASSWORD.length}\r\n${REDIS_PASSWORD}\r\n`;
      // FLUSHALL
      const flushCmd = `*1\r\n$8\r\nFLUSHALL\r\n`;
      socket.write(authCmd + flushCmd);
    });

    socket.on('data', (data) => {
      resp += data.toString();
      // Wait for two responses (AUTH + FLUSHALL)
      if (resp.split('\r\n').filter(Boolean).length >= 2) {
        socket.end();
        resolve(resp.trim());
      }
    });

    socket.on('timeout', () => { socket.destroy(); reject(new Error('Timeout')); });
    socket.on('error', reject);
  });
}

try {
  const result = await sendCommand();
  console.log('Redis response:', result);
  if (result.includes('+OK')) {
    console.log('🎉 Redis FLUSHALL successful — all sessions cleared!');
  } else {
    console.log('⚠️ Unexpected response from Redis');
  }
} catch (err) {
  console.error('❌ Redis flush failed:', err.message);
  process.exit(1);
}
