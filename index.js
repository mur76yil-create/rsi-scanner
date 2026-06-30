const https = require('https');
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('RSI Scanner Calisiyor');
});
server.listen(process.env.PORT || 3000, () => console.log('Web sunucusu calisiyor'));

const BOT_TOKEN = '8989114111:AAGnva0Lk7VFfYtzbTXwD7VvZ5GIA9cT11k';
const CHAT_ID = '704487787';
const RSI_PERIOD = 14;
const RSI_LOW = 30;
const RSI_HIGH = 75;
const SCAN_INTERVAL = 60000;

let lastScan30m = '';
let lastScan1h = '';
let running = true;
let lastUpdateId = 0;

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 20000
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('JSON parse error: ' + data.substring(0, 100))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 10000
    };
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', chunk => d += chunk);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendTelegram(msg) {
  try {
    await post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      chat_id: CHAT_ID, text: msg, parse_mode: 'HTML'
    });
    console.log('[TELEGRAM] Gonderildi');
  } catch(e) {
    console.log('[TELEGRAM] Hata:', e.message);
  }
}

async function getUpdates() {
  try {
    const r = await fetchJSON(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=1`);
    return r.result || [];
  } catch(e) { console.log('[HATA] Updates:', e.message); return []; }
}

async function handleCommands() {
  const updates = await getUpdates();
  for (const u of updates) {
    lastUpdateId = u.update_id;
    const msg = u.message?.text;
    const fromId = u.message?.from?.id?.toString();
    if (fromId !== CHAT_ID || !msg) continue;
    
    console.log('[KOMUT]', msg);
    
    if (msg === '/start') {
      running = true;
      await sendTelegram('<b>Scanner Baslatildi!</b>\n\nKomutlar:\n/scan - Simdi tara\n/dur - Durdur\n/devam - Devam et\n/durum - Durum bilgisi');
    } else if (msg === '/dur') {
      running = false;
      await sendTelegram('<b>Scanner Durduruldu!</b>');
    } else if (msg === '/devam') {
      running = true;
      await sendTelegram('<b>Scanner Devam Ediyor!</b>');
    } else if (msg === '/scan') {
      await sendTelegram('Tarama basliyor...');
      await scanAndNotify('MANUEL TARAMA');
    } else if (msg === '/durum') {
      const status = running ? 'CALISIYOR' : 'DURDU';
      await sendTelegram(`<b>Scanner Durumu</b>\n\nDurum: ${status}\nSon 30m: ${lastScan30m}\nSon 1h: ${lastScan1h}\nRSI: <${RSI_LOW} veya >${RSI_HIGH}`);
    }
  }
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const deltas = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i-1]);
  const gains = deltas.map(d => d > 0 ? d : 0);
  const losses = deltas.map(d => d < 0 ? -d : 0);
  let avgGain = gains.slice(0, period).reduce((a,b) => a+b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < deltas.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - (100 / (1 + rs))) * 10) / 10;
}

async function getTopSymbols(limit = 50) {
  try {
    const data = await fetchJSON('https://api.binance.com/api/v3/ticker/24hr');
    if (!Array.isArray(data)) { console.log('[HATA] Binance response:', typeof data); return []; }
    return data
      .filter(d => d.symbol.endsWith('USDT') && !d.symbol.match(/UP|DOWN|BULL|BEAR|4L|3L|2L|2S|3S|4S/))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, limit)
      .map(d => d.symbol);
  } catch(e) { console.log('[HATA] getTopSymbols:', e.message); return []; }
}

async function getKlines(symbol, interval, limit = 100) {
  return await fetchJSON(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
}

async function scanAndNotify(label) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`[${new Date().toLocaleTimeString('tr-TR')}] ${label} Taramasi`);
  
  const symbols = await getTopSymbols(50);
  if (!symbols.length) { console.log('[HATA] Symbol listesi alinamadi'); return; }
  
  console.log(`[INFO] ${symbols.length} coin taranacak`);
  const found = [];
  
  for (const sym of symbols) {
    try {
      const [k30, k1h] = await Promise.all([
        getKlines(sym, '30m'),
        getKlines(sym, '1h')
      ]);
      
      if (!k30?.length || !k1h?.length) continue;
      if (k30.length < RSI_PERIOD + 1 || k1h.length < RSI_PERIOD + 1) continue;
      
      const c30 = k30.map(k => parseFloat(k[4]));
      const c1h = k1h.map(k => parseFloat(k[4]));
      const r30 = calcRSI(c30);
      const r1h = calcRSI(c1h);
      
      if (r30 === null || r1h === null) continue;
      
      const price = c30[c30.length - 1];
      const chg30 = c30.length >= 2 ? Math.round((c30[c30.length-1] - c30[c30.length-2]) / c30[c30.length-2] * 10000) / 100 : 0;
      const chg1h = c1h.length >= 2 ? Math.round((c1h[c1h.length-1] - c1h[c1h.length-2]) / c1h[c1h.length-2] * 10000) / 100 : 0;
      
      const isLow30 = r30 < RSI_LOW;
      const isHigh30 = r30 > RSI_HIGH;
      const isLow1h = r1h < RSI_LOW;
      const isHigh1h = r1h > RSI_HIGH;
      
      let trigger = false, direction = '';
      if (isLow30 || isLow1h) { trigger = true; direction = 'DOWN'; }
      if (isHigh30 || isHigh1h) { trigger = true; direction = 'UP'; }
      
      const color = (isLow30 || isLow1h) ? 'GREEN' : (isHigh30 || isHigh1h) ? 'RED' : '';
      console.log(`  ${sym}: RSI30m=${r30} | RSI1h=${r1h} | Price=${price} ${color}`);
      
      if (trigger) {
        const boost30 = chg30 >= 0 ? `+${chg30}%` : `${chg30}%`;
        const boost1h = chg1h >= 0 ? `+${chg1h}%` : `${chg1h}%`;
        const arrow30 = isHigh30 ? ' >>>' : isLow30 ? ' vvv' : '';
        const arrow1h = isHigh1h ? ' >>>' : isLow1h ? ' vvv' : '';
        const tvLink = `https://www.tradingview.com/chart/?symbol=BINANCE:${sym}`;
        
        const msg = `<b>${sym}</b> (${label})\nFiyat: <b>${price} USDT</b>\n\n30m RSI: <b>${r30}${arrow30}</b> (${boost30})\n1h RSI: <b>${r1h}${arrow1h}</b> (${boost1h})\n\n<a href="${tvLink}">TradingView</a>`;
        found.push({ sym, msg });
      }
    } catch(e) { continue; }
  }
  
  if (found.length) {
    for (const f of found) {
      await sendTelegram(f.msg);
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[BULUNDU] ${found.length} coin gonderildi`);
  } else {
    console.log('[BOS] Sinyal yok');
  }
}

async function main() {
  console.log('RSI Scanner Cloud v1 Baslatildi');
  console.log(`  RSI: <${RSI_LOW} veya >${RSI_HIGH}`);
  console.log(`  Telegram: ${CHAT_ID}`);
  
  await sendTelegram('<b>RSI Scanner Cloud Baslatildi!</b>\n\nPC kapali olsa da calisiyor!\n\nKomutlar:\n/scan - Simdi tara\n/dur - Durdur\n/devam - Devam et\n/durum - Durum bilgisi');
  
  await scanAndNotify('ILK TARAMA');
  
  setInterval(async () => {
    await handleCommands();
    if (!running) return;
    
    const now = new Date();
    const min = now.getMinutes();
    const ts = `${String(now.getHours()).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
    
    if ((min === 0 || min === 30) && ts !== lastScan30m) {
      await scanAndNotify('30m Kapanis');
      lastScan30m = ts;
    }
    if (min === 0 && ts !== lastScan1h) {
      await scanAndNotify('1h Kapanis');
      lastScan1h = ts;
    }
  }, SCAN_INTERVAL);
}

main().catch(console.error);
