const { listTransactions, insertTransaction, removeTransaction, clearTransactions } = require('./_lib/store');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const transactions = await listTransactions();
      return res.status(200).json({ transactions });
    }

    if (req.method === 'POST') {
      const created = await insertTransaction({ ...(req.body || {}), source: 'web' });
      return res.status(201).json({ transaction: created });
    }

    if (req.method === 'DELETE') {
      if (req.query && req.query.id) {
        await removeTransaction(req.query.id);
      } else {
        await clearTransactions();
      }
      return res.status(204).end();
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};
