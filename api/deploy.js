// api/deploy.js — Sajeel Hosting Final (Auto-Disable Protection + Clean URL)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const body = req.body || {};
  const html = body.html;
  const name = body.name || 'portfolio';

  if (!html || typeof html !== 'string') {
    return res.status(400).json({ error: 'Missing "html" in request body.' });
  }

  const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
  if (!VERCEL_TOKEN) {
    return res.status(500).json({ error: 'Server misconfigured: VERCEL_TOKEN missing.' });
  }

  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'portfolio';

  const projectName = 'portfolio-' + slug;
  const base64Content = Buffer.from(html, 'utf-8').toString('base64');

  const headers = {
    'Authorization': 'Bearer ' + VERCEL_TOKEN,
    'Content-Type': 'application/json',
  };

  try {
    console.log('[Deploy] Creating project deployment:', projectName);

    // ===== STEP 1: Create deployment =====
    const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: projectName,
        files: [{ file: 'index.html', data: base64Content, encoding: 'base64' }],
        projectSettings: {
          framework: null,
          buildCommand: null,
          outputDirectory: null,
          installCommand: null,
        },
        target: 'production'
      })
    });

    const deployData = await deployRes.json();

    if (!deployRes.ok) {
      console.error('[Deploy] Failed:', JSON.stringify(deployData));
      return res.status(deployRes.status).json({
        error: (deployData.error && deployData.error.message) || 'Deployment failed'
      });
    }

    const deploymentUrl = 'https://' + deployData.url;
    const teamId = deployData.teamId;
    const teamQuery = teamId ? '?teamId=' + teamId : '';

    console.log('[Deploy] Deployment created:', deploymentUrl);

    // ===== STEP 2: Disable Deployment Protection (SSO) Automatically =====
    try {
      const patchRes = await fetch('https://api.vercel.com/v9/projects/' + projectName + teamQuery, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          ssoProtection: null,         // Disables Standard Protection
          passwordProtection: null     // Disables Password Protection if any
        })
      });
      
      if (patchRes.ok) {
        console.log('[Deploy] ✅ Protection disabled for public access');
      } else {
        console.warn('[Deploy] ⚠️ Could not disable protection:', await patchRes.text());
      }
    } catch (patchErr) {
      console.warn('[Deploy] Protection patch failed:', patchErr.message);
    }

    // ===== STEP 3: Generate Clean URL =====
    let cleanUrl = null;
    const urlWithoutDomain = deployData.url.replace(/\.vercel\.app$/, '');

    if (urlWithoutDomain.startsWith(projectName + '-')) {
      const rest = urlWithoutDomain.slice(projectName.length + 1);
      const m = rest.match(/^([a-z0-9]{8,12})(?:-(.+))?$/);
      if (m) {
        const teamSlug = m[2];
        cleanUrl = 'https://' + projectName + (teamSlug ? '-' + teamSlug : '') + '.vercel.app';
      }
    }

    // ===== STEP 4: Try getting official alias =====
    let aliasUrl = null;
    try {
      const aliasesRes = await fetch(
        'https://api.vercel.com/v2/deployments/' + deployData.id + '/aliases' + teamQuery,
        { headers }
      );
      if (aliasesRes.ok) {
        const ad = await aliasesRes.json();
        const vercelAliases = (ad.aliases || [])
          .map(a => a.alias || a.domain || '')
          .filter(a => a && a.endsWith('.vercel.app'))
          .sort((a, b) => a.length - b.length);
        if (vercelAliases.length > 0) {
          aliasUrl = 'https://' + vercelAliases[0];
        }
      }
    } catch (e) {}

    const finalUrl = aliasUrl || cleanUrl || deploymentUrl;
    console.log('[Deploy] ✅ Final URL:', finalUrl);

    return res.status(200).json({
      url: finalUrl,
      deploymentUrl: deploymentUrl,
      project: projectName
    });

  } catch (err) {
    console.error('[Deploy] Exception:', err);
    return res.status(500).json({ error: err.message || 'Deploy failed' });
  }
};