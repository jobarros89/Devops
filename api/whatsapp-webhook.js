const { insertTransaction } = require('./_lib/store');

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'dev_token';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const GRAPH_API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v21.0';

function parseWhatsappMessage(text) {
  if (!text) return null;

  const normalized = text.trim().replace(',', '.');
  const [typeRaw, amountRaw, ...descriptionParts] = normalized.split(/\s+/);

  const type = (typeRaw || '').toLowerCase();
  if (!['credito', 'debito'].includes(type)) return null;

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const rest = descriptionParts.join(' ').trim();
  const categoryMatch = rest.match(/#([\p{L}0-9_-]+)/u);
  const category = categoryMatch ? categoryMatch[1] : 'WhatsApp';
  const description = rest.replace(/#[\p{L}0-9_-]+/gu, '').trim() || 'Lançamento via WhatsApp';

  return {
    id: Date.now(),
    type,
    amount,
    description,
    category,
    date: new Date().toISOString().slice(0, 10),
    source: 'whatsapp'
  };
}

async function sendWhatsappText(to, body) {
  if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN || !to) {
    return;
  }

  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      text: { body }
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Falha ao responder WhatsApp: ${details}`);
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send('forbidden');
  }

  if (req.method === 'POST') {
    try {
      const change = req.body?.entry?.[0]?.changes?.[0]?.value;
      const message = change?.messages?.[0];
      const from = message?.from;
      const messageText = message?.text?.body;

      const parsed = parseWhatsappMessage(messageText);

      if (!parsed) {
        await sendWhatsappText(from, 'Formato inválido. Use: credito 120.50 almoço #alimentacao');
        return res.status(200).json({ ok: true, ignored: true });
      }

      await insertTransaction(parsed);

      const confirmation = `✅ ${parsed.type.toUpperCase()} de R$ ${parsed.amount.toFixed(2)} registrado: ${parsed.description} (${parsed.category}).`;
      await sendWhatsappText(from, confirmation);

      return res.status(200).json({ ok: true });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method Not Allowed' });
};
