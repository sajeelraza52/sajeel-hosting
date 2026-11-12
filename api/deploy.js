// api/deploy.js — Sajeel Hosting Deploy Function (with stable alias)
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
    return res.status(500).json({
      error: 'Server misconfigured: VERCEL_TOKEN missing.'
    });
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
    // Step 1: Create deployment
    const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: projectName,
        files: [{
          file: 'index.html',
          data: base64Content,
          encoding: 'base64'
        }],
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
      console.error('Vercel deploy error:', deployData);
      return res.status(deployRes.status).json({
        error: (deployData.error && deployData.error.message) || 'Deployment failed'
      });
    }

    // Step 2: Try to assign a stable alias
    // Clean URL: portfolio-<slug>.vercel.app
    const aliasTarget = projectName + '.vercel.app';
    let finalUrl = 'https://' + (
      (deployData.alias && deployData.alias[0]) || deployData.url
    );

    // Attempt alias assignment (best-effort)
    try {
      const aliasRes = await fetch(
        'https://api.vercel.com/v2/deployments/' + deployData.id + '/aliases',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ alias: aliasTarget })
        }
      );

      if (aliasRes.ok) {
        // Alias assigned successfully — use clean URL
        finalUrl = 'https://' + aliasTarget;
      } else {
        const aliasErr = await aliasRes.json();
        console.warn('Alias assignment skipped:', aliasErr.error?.message || aliasErr);
        // Fallback: use deployment URL (still works, just not clean)
      }
    } catch (aliasErr) {
      console.warn('Alias attempt failed:', aliasErr.message);
    }

    return res.status(200).json({
      url: finalUrl,
      deploymentUrl: 'https://' + deployData.url,
      id: deployData.id || null,
      project: projectName,
      aliased: finalUrl.includes(aliasTarget)
    });

  } catch (err) {
    console.error('Deploy error:', err);
    return res.status(500).json({ error: err.message || 'Deploy failed' });
  }
};