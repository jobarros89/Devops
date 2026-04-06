const TABLE = process.env.SUPABASE_TRANSACTIONS_TABLE || 'transactions';

function getSupabaseConfig() {
  const baseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!baseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  }

  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    serviceRoleKey
  };
}

async function supabaseRequest(path, options = {}) {
  const { baseUrl, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Erro Supabase (${response.status}): ${details}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function normalizeTransaction(input) {
  const amount = Number(input.amount);

  if (!input.description || !input.type || !input.date || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('Transação inválida');
  }

  return {
    id: Number(input.id || Date.now()),
    description: String(input.description).trim(),
    amount,
    type: input.type === 'credito' ? 'credito' : 'debito',
    category: String(input.category || 'WhatsApp').trim(),
    date: input.date,
    source: String(input.source || 'web').trim()
  };
}

async function listTransactions() {
  return supabaseRequest(`${TABLE}?select=*&order=id.desc`);
}

async function insertTransaction(input) {
  const payload = normalizeTransaction(input);
  const rows = await supabaseRequest(TABLE, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return rows[0];
}

async function removeTransaction(id) {
  await supabaseRequest(`${TABLE}?id=eq.${Number(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

async function clearTransactions() {
  await supabaseRequest(`${TABLE}?id=gte.0`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

module.exports = {
  listTransactions,
  insertTransaction,
  removeTransaction,
  clearTransactions
};
