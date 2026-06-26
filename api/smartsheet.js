// Leitura do Smartsheet via API (proxy serverless).
// GET /api/smartsheet?sheetId=NNNNNNNNNN
// Usa a variável de ambiente SMARTSHEET_TOKEN (Access Token da API do Smartsheet).
// Retorna { sheetName, columns:[títulos], rows:[ {Título: valor, ...} ] }.
// O token NUNCA é exposto ao navegador — fica só no servidor (Vercel).

const API = 'https://api.smartsheet.com/2.0';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Método não permitido.' }); return; }

  try {
    const token = process.env.SMARTSHEET_TOKEN;
    if (!token) { res.status(500).json({ error: 'SMARTSHEET_TOKEN não configurado no servidor.' }); return; }

    let sheetId = req.query && req.query.sheetId;
    if (!sheetId) {
      try { sheetId = new URL(req.url, 'http://x').searchParams.get('sheetId'); } catch (e) {}
    }
    if (!sheetId || !/^[0-9]+$/.test(String(sheetId))) {
      res.status(400).json({ error: 'Parâmetro sheetId inválido.' }); return;
    }

    const r = await fetch(`${API}/sheets/${sheetId}`, {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' }
    });
    if (!r.ok) {
      const e = await r.text();
      res.status(502).json({ error: 'Falha no Smartsheet: ' + r.status + ' ' + e.slice(0, 200) });
      return;
    }
    const sheet = await r.json();

    const cols = sheet.columns || [];
    const idToTitle = {};
    cols.forEach(c => { idToTitle[c.id] = c.title; });

    const rows = (sheet.rows || []).map(row => {
      const o = {};
      (row.cells || []).forEach(cell => {
        const title = idToTitle[cell.columnId];
        if (title) {
          const raw = cell.value;
          if (typeof raw === 'number') {
            // número cru em formato BR (vírgula decimal, sem separador de milhar)
            // para o parser do dashboard (dmNum) ler corretamente.
            o[title] = String(raw).replace('.', ',');
          } else if (typeof raw === 'boolean') {
            o[title] = raw ? 'TRUE' : 'FALSE';
          } else {
            o[title] = (cell.displayValue != null && cell.displayValue !== '')
              ? cell.displayValue
              : (raw != null ? raw : '');
          }
        }
      });
      return o;
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ sheetName: sheet.name, columns: cols.map(c => c.title), rows: rows });
  } catch (err) {
    console.error('Erro em /api/smartsheet:', err);
    res.status(500).json({ error: 'Erro interno: ' + (err && err.message) });
  }
};
