// api/deploy.js — v4 (Sajeel Mods Hosting)
// Deploys MULTIPLE files to Vercel, then assigns the clean production
// domain (sajeel-<name>.vercel.app) as an alias, so the returned link is
// the short public URL instead of the deployment URL.
//
// Contracts accepted:
//   NEW: POST { name, files: [{ name, data }] }  — data = base64, name may
//        include subfolders like "css/style.css" (no ".." or absolute paths)
//   OLD: POST { html, name } — single index.html (backwards compatible,
//        treated as files=[{name:'index.html', data: base64(html)}])
//
// If aliasing fails we still return 200 with the deployment URL + aliasError,
// so the deploy itself never fails just because the alias did.
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};

  // ---- Normalize input: new multi-file contract, or old single-html one ----
  let files = [];
  if (Array.isArray(body.files) && body.files.length) {
    files = body.files;
  } else if (body.html && body.name) {
    files = [{ name: 'index.html', data: Buffer.from(body.html, 'utf-8').toString('base64') }];
  }

  const name = body.name;
  if (!name) {
    return res.status(400).json({ error: 'name required' });
  }
  if (!files.length) {
    return res.status(400).json({ error: 'at least one file required' });
  }
  for (const f of files) {
    if (!f || typeof f.name !== 'string' || !f.name || typeof f.data !== 'string' || !f.data) {
      return res.status(400).json({ error: 'each file needs a name and base64 data' });
    }
  }

  // ---- Sanitize file paths: no absolute paths, no ".." segments ----
  const cleanFiles = [];
  for (const f of files) {
    const p = String(f.name).replace(/\\/g, '/').replace(/^\.\//, '');
    const segments = p.split('/');
    if (
      !p || p.startsWith('/') ||
      segments.some((s) => s === '..' || s === '' )
    ) {
      return res.status(400).json({ error: 'invalid file name: ' + f.name });
    }
    cleanFiles.push({ name: p, data: f.data });
  }

  const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
  if (!VERCEL_TOKEN) {
    return res.status(500).json({ error: 'Server misconfigured: missing VERCEL_TOKEN' });
  }

  // ---- Slug: same rules as the frontend (lowercase, dashes, max 40, fallback) ----
  let slug = String(name).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
  if (!slug) slug = 'site-' + Date.now().toString(36);

  const projectName = 'sajeel-' + slug;
  const cleanAlias = projectName + '.vercel.app';

  try {
    const response = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: projectName,
        files: cleanFiles.map((f) => ({
          file: f.name,
          data: f.data,
          encoding: 'base64',
        })),
        projectSettings: {
          framework: null,
          buildCommand: null,
          outputDirectory: null,
          installCommand: null,
        },
        target: 'production',
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Vercel API error:', data);
      return res.status(500).json({ error: data.error?.message || 'Deployment failed' });
    }

    const deployUrl = 'https://' + (data.alias?.[0] || data.url);

    // Assign the clean production domain to this deployment.
    let url = deployUrl;
    let aliasError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const aliasRes = await fetch(
          'https://api.vercel.com/v2/deployments/' + data.id + '/aliases',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${VERCEL_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ alias: cleanAlias }),
          }
        );
        const aliasData = await aliasRes.json().catch(() => ({}));
        if (aliasRes.ok) {
          url = 'https://' + cleanAlias;
          aliasError = null;
          break;
        }
        aliasError = aliasData.error?.message || ('Alias failed (HTTP ' + aliasRes.status + ')');
        console.error('Alias error (attempt ' + (attempt + 1) + '):', aliasData);
      } catch (e) {
        aliasError = e.message;
        console.error('Alias error (attempt ' + (attempt + 1) + '):', e);
      }
      // Deployment abhi ready nahi hui hogi — 2 second ruk ke ek dafa dobara try karo
      if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
    }

    // Return the live URL (clean one if aliasing worked, deployment URL otherwise)
    return res.status(200).json(aliasError ? { url, aliasError } : { url });
  } catch (err) {
    console.error('Deploy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
