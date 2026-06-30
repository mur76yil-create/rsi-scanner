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

async function fetchJSON(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch(e) { clearTimeout(timeout); throw e; }
}

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const options = { hostname: u.hostname, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: 10000 };
    const req = https.request(options, (res) => { let d = ''; res.on('data', chunk => d += chunk); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(d); } }); });
    req.on('error', reject); req.write(data); req.end();
  });
}

async function sendTelegram(msg) {
  try { await post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }); console.log('[TELEGRAM] Gonderildi'); }
  catch(e) { console.log('[TELEGRAM] Hata:', e.message); }
}

async function getUpdates() {
  try { const r = await fetchJSON(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=1`); return r.result || []; }
  catch(e) { return []; }
}

async function handleCommands() {
  const updates = await getUpdates();
  for (const u of updates) {
    lastUpdateId = u.update_id;
    const msg = u.message?.text;
    const fromId = u.message?.from?.id?.toString();
    if (fromId !== CHAT_ID || !msg) continue;
    console.log('[KOMUT]', msg);
    if (msg === '/start') { running = true; await sendTelegram('<b>Scanner Baslatildi!</b>\n\n/scan /dur /devam /durum'); }
    else if (msg === '/dur') { running = false; await sendTelegram('<b>Durduruldu!</b>'); }
    else if (msg === '/devam') { running = true; await sendTelegram('<b>Devam Ediyor!</b>'); }
    else if (msg === '/scan') { await sendTelegram('Tarama basliyor...'); await scanAndNotify('MANUEL TARAMA'); }
    else if (msg === '/durum') { await sendTelegram(`<b>Durum:</b> ${running?'CALISIYOR':'DURDU'}\nSon 30m: ${lastScan30m}\nSon 1h: ${lastScan1h}`); }
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
  for (let i = period; i < deltas.length; i++) { avgGain = (avgGain * (period - 1) + gains[i]) / period; avgLoss = (avgLoss * (period - 1) + losses[i]) / period; }
  if (avgLoss === 0) return 100;
  return Math.round((100 - (100 / (1 + avgGain/avgLoss))) * 10) / 10;
}

const TOP_COINS = ['BTC','ETH','SOL','XRP','DOGE','ADA','AVAX','DOT','LINK','UNI','LTC','ATOM','NEAR','APT','SUI','ARB','OP','FIL','INJ','TIA','SEI','PEPE','SHIB','FET','RENDER','TRX','TON','BNB','XLM','VET','ICP','AAVE','MKR','ENA','WLD','PYTH'];

async function getCandles(symbol) {
  const url = `https://min-api.cryptocompare.com/data/v2/histominute?fsym=${symbol}&tsym=USDT&limit=100&aggregate=30`;
  try {
    const data = await fetchJSON(url);
    if (data?.Data?.Data) return data.Data.Data.map(c => c.close);
  } catch(e) {}
  return null;
}

async function getCandles1h(symbol) {
  const url = `https://min-api.cryptocompare.com/data/v2/histohour?fsym=${symbol}&tsym=USDT&limit=100`;
  try {
    const data = await fetchJSON(url);
    if (data?.Data?.Data) return data.Data.Data.map(c => c.close);
  } catch(e) {}
  return null;
}

async function scanAndNotify(label) {
  console.log(`\n[${new Date().toLocaleTimeString('tr-TR')}] ${label}`);
  const found = [];
  for (const sym of TOP_COINS) {
    try {
      const [c30, c1h] = await Promise.all([getCandles(sym), getCandles1h(sym)]);
      if (!c30 || !c1h || c30.length < 15 || c1h.length < 15) { console.log(`  ${sym}: Veri yok`); continue; }
      const r30 = calcRSI(c30), r1h = calcRSI(c1h);
      if (r30 === null || r1h === null) continue;
      const price = c30[c30.length - 1];
      const chg30 = Math.round((c30[c30.length-1] - c30[c30.length-2]) / c30[c30.length-2] * 10000) / 100;
      const chg1h = Math.round((c1h[c1h.length-1] - c1h[c1h.length-2]) / c1h[c1h.length-2] * 10000) / 100;
      const isLow30 = r30 < RSI_LOW, isHigh30 = r30 > RSI_HIGH, isLow1h = r1h < RSI_LOW, isHigh1h = r1h > RSI_HIGH;
      let trigger = false;
      if (isLow30 || isLow1h) trigger = true;
      if (isHigh30 || isHigh1h) trigger = true;
      console.log(`  ${sym}: 30m=${r30} 1h=${r1h} $${price}`);
      if (trigger) {
        const b30 = chg30 >= 0 ? `+${chg30}%` : `${chg30}%`, b1h = chg1h >= 0 ? `+${chg1h}%` : `${chg1h}%`;
        const a30 = isHigh30 ? ' >>>' : isLow30 ? ' vvv' : '', a1h = isHigh1h ? ' >>>' : isLow1h ? ' vvv' : '';
        found.push(`<b>${sym}USDT</b> (${label})\nFiyat: <b>$${price}</b>\n\n30m RSI: <b>${r30}${a30}</b> (${b30})\n1h RSI: <b>${r1h}${a1h}</b> (${b1h})\n\n<a href="https://www.tradingview.com/chart/?symbol=BINANCE:${sym}USDT">TradingView</a>`);
      }
    } catch(e) { console.log(`  ${sym}: HATA ${e.message}`); continue; }
  }
  for (const f of found) { await sendTelegram(f); await new Promise(r => setTimeout(r, 500)); }
  console.log(`[SONUC] ${found.length} coin gonderildi`);
}

async function main() {
  console.log('RSI Scanner Cloud v4 - CryptoCompare');
  await sendTelegram('<b>RSI Scanner v4 Baslatildi!</b>\n\n/scan /dur /devam /durum');
  await scanAndNotify('ILK TARAMA');
  setInterval(async () => {
    await handleCommands();
    if (!running) return;
    const now = new Date(), min = now.getMinutes(), ts = `${String(now.getHours()).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
    if ((min === 0 || min === 30) && ts !== lastScan30m) { await scanAndNotify('30m Kapanis'); lastScan30m = ts; }
    if (min === 0 && ts !== lastScan1h) { await scanAndNotify('1h Kapanis'); lastScan1h = ts; }
  }, SCAN_INTERVAL);
}

main().catch(console.error);
