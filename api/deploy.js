// api/deploy.js — Final working version with clean URL
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
    // ===== STEP 1: Create deployment =====
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
      console.error('Deploy failed:', deployData);
      return res.status(deployRes.status).json({
        error: (deployData.error && deployData.error.message) || 'Deployment failed'
      });
    }

    // ===== STEP 2: Find the cleanest URL =====
    let cleanUrl = null;
    let teamId = deployData.teamId || null;

    // Strategy A: Vercel's alias array (usually contains clean domain)
    if (deployData.alias && Array.isArray(deployData.alias) && deployData.alias.length > 0) {
      // Pick shortest vercel.app alias (cleanest)
      const candidates = deployData.alias
        .filter(a => typeof a === 'string' && a.endsWith('.vercel.app'))
        .sort((a, b) => a.length - b.length);
      if (candidates.length > 0) {
        cleanUrl = 'https://' + candidates[0];
      }
    }

    // Strategy B: Query project to get its assigned production domain
    if (!cleanUrl) {
      try {
        const qs = teamId ? ('?teamId=' + teamId) : '';
        const projRes = await fetch(
          'https://api.vercel.com/v9/projects/' + projectName + qs,
          { headers: { 'Authorization': 'Bearer ' + VERCEL_TOKEN } }
        );
        if (projRes.ok) {
          const projData = await projRes.json();

          // Method 1: targets.production.alias
          const prodAlias = projData.targets &&
            projData.targets.production &&
            projData.targets.production.alias;
          if (Array.isArray(prodAlias) && prodAlias.length > 0) {
            cleanUrl = 'https://' + prodAlias[0];
          }

          // Method 2: domains array
          if (!cleanUrl && Array.isArray(projData.domains)) {
            const vercelDomain = projData.domains
              .filter(d => d.endsWith('.vercel.app'))
              .sort((a, b) => a.length - b.length)[0];
            if (vercelDomain) cleanUrl = 'https://' + vercelDomain;
          }

          // Method 3: name-based construction (project name + team slug)
          if (!cleanUrl) {
            // Check if deploy URL contains team slug we can extract
            // Deployment URL: portfolio-ali-hassan-mwd25vlf-sajeel-razas-projects.vercel.app
            const deployUrl = deployData.url || '';
            // The hash part is typically 8-10 alphanumeric chars between project and team
            const hashMatch = deployUrl.match(
              new RegExp('^' + escapeRegex(projectName) + '-([a-z0-9]{8,12})-(.+)\\.vercel\\.app$')
            );
            if (hashMatch) {
              const teamSlug = hashMatch[2];
              // Construct clean team-scoped URL
              cleanUrl = 'https://' + projectName + '-' + teamSlug + '.vercel.app';
            }
          }
        }
      } catch (projErr) {
        console.warn('Project lookup failed:', projErr.message);
      }
    }

    // ===== STEP 3: Try to assign alias explicitly =====
    if (!cleanUrl) {
      const cleanAlias = projectName + '.vercel.app';
      try {
        const aliasUrl = 'https://api.vercel.com/v2/deployments/' +
          deployData.id + '/aliases' +
          (teamId ? '?teamId=' + teamId : '');
        const aliasRes = await fetch(aliasUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ alias: cleanAlias })
        });
        if (aliasRes.ok) {
          cleanUrl = 'https://' + cleanAlias;
        }
      } catch (aliasErr) {
        console.warn('Alias attempt failed:', aliasErr.message);
      }
    }

    // ===== STEP 4: Fallback =====
    const deploymentUrl = 'https://' + deployData.url;
    const finalUrl = cleanUrl || deploymentUrl;

    return res.status(200).json({
      url: finalUrl,
      deploymentUrl: deploymentUrl,
      project: projectName,
      hasCleanAlias: !!cleanUrl
    });

  } catch (err) {
    console.error('Deploy error:', err);
    return res.status(500).json({ error: err.message || 'Deploy failed' });
  }
};

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}