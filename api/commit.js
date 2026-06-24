// Salvar = commitar no GitHub.
// POST /api/commit  -> grava as bases do dashboard no arquivo dados_app.json do repositório,
// via GitHub Contents API. O Vercel republica sozinho e os dados ficam versionados no repo.
//
// Exige header 'x-edit-password' == process.env.EDIT_PASSWORD.
//
// Variáveis de ambiente necessárias no projeto Vercel:
//   - EDIT_PASSWORD : senha que libera o salvar.
//   - GITHUB_TOKEN  : token do GitHub com permissão de escrita em "Contents" deste repo
//                     (Fine-grained PAT -> Repository access: este repo -> Contents: Read and write).
//   - (opcional) GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, DATA_PATH para sobrescrever os padrões.

const OWNER  = process.env.GITHUB_OWNER  || 'tovani069';
const REPO   = process.env.GITHUB_REPO   || 'dextro_indicadores_CDC';
const BRANCH = process.env.GITHUB_BRANCH || 'master';
const PATH   = process.env.DATA_PATH     || 'dados_app.json';

const GH = 'https://api.github.com';

function ghHeaders(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'codec-dashboard',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-edit-password');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido.' }); return; }

  try {
    const expected = process.env.EDIT_PASSWORD;
    const token = process.env.GITHUB_TOKEN;
    if (!expected) { res.status(500).json({ error: 'EDIT_PASSWORD não configurada no servidor.' }); return; }
    if (!token)    { res.status(500).json({ error: 'GITHUB_TOKEN não configurado no servidor.' }); return; }

    const sent = req.headers['x-edit-password'];
    if (!sent || sent !== expected) { res.status(401).json({ error: 'Senha de edição incorreta.' }); return; }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { res.status(400).json({ error: 'JSON inválido no corpo.' }); return; }
    }
    if (!body || typeof body !== 'object') { res.status(400).json({ error: 'Corpo vazio ou inválido.' }); return; }

    const content = Buffer.from(JSON.stringify(body, null, 2), 'utf8').toString('base64');

    // Descobre o SHA atual do arquivo (se já existir) — necessário para sobrescrever.
    let sha;
    const getUrl = `${GH}/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(PATH)}?ref=${BRANCH}`;
    const getRes = await fetch(getUrl, { headers: ghHeaders(token) });
    if (getRes.status === 200) {
      const cur = await getRes.json();
      sha = cur.sha;
    } else if (getRes.status !== 404) {
      const e = await getRes.text();
      res.status(502).json({ error: 'Falha ao consultar o GitHub: ' + getRes.status + ' ' + e.slice(0, 200) });
      return;
    }

    const putUrl = `${GH}/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(PATH)}`;
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: ghHeaders(token),
      body: JSON.stringify({
        message: 'chore: atualizar dados do dashboard (' + new Date().toISOString() + ')',
        content,
        branch: BRANCH,
        sha, // undefined cria o arquivo na primeira vez
      }),
    });

    if (!putRes.ok) {
      const e = await putRes.text();
      res.status(502).json({ error: 'Falha ao salvar no GitHub: ' + putRes.status + ' ' + e.slice(0, 300) });
      return;
    }

    const out = await putRes.json();
    res.status(200).json({ ok: true, commit: out.commit && out.commit.sha });
  } catch (err) {
    console.error('Erro em /api/commit:', err);
    res.status(500).json({ error: 'Erro interno: ' + (err && err.message) });
  }
};
