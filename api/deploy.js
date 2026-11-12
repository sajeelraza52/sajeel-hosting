// api/deploy.js — v2
// Deploys a single index.html to Vercel, then assigns the clean production
// domain (portfolio-<name>.vercel.app) as an alias, so the returned link is
// the short public URL instead of the deployment URL.
// (API-created projects don't always get the clean domain automatically —
//  that's why the clean link 404'd before. If aliasing fails we fall back
//  to the deployment URL, so the deploy still works.)
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { html, name } = req.body;
  if (!html || !name) {
    return res.status(400).json({ error: 'html and name required' });
  }

  const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
  if (!VERCEL_TOKEN) {
    return res.status(500).json({ error: 'Server misconfigured: missing VERCEL_TOKEN' });
  }

  // Base64 encode the HTML
  const base64Content = Buffer.from(html, 'utf-8').toString('base64');
  const projectName = 'portfolio-' + name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
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
        files: [
          {
            file: 'index.html',
            data: base64Content,
            encoding: 'base64'
          }
        ],
        projectSettings: {
          framework: null,
          buildCommand: null,
          outputDirectory: null,
          installCommand: null,
        },
        target: 'production'
      })
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
      if (attempt === 0) await new Promise(r => setTimeout(r, 2000));
    }

    // Return the live URL (clean one if aliasing worked, deployment URL otherwise)
    return res.status(200).json(aliasError ? { url, aliasError } : { url });
  } catch (err) {
    console.error('Deploy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
