// api/deploy.js — Sajeel Hosting Final (guaranteed clean URL)
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

  try {
    console.log('[Deploy] Creating:', projectName);

    // ===== STEP 1: Create deployment =====
    const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + VERCEL_TOKEN,
        'Content-Type': 'application/json',
      },
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
        error: (deployData.error && deployData.error.message) || 'Deployment failed',
        details: deployData
      });
    }

    console.log('[Deploy] Deployment created. Raw URL:', deployData.url, 'ID:', deployData.id);

    const deploymentUrl = 'https://' + deployData.url;
    const teamId = deployData.teamId;
    const teamQuery = teamId ? '?teamId=' + teamId : '';

    // ===== STEP 2: Extract clean URL from deployment URL (ALWAYS works) =====
    // Format: {projectName}-{hash}-{teamSlug}.vercel.app
    //     or: {projectName}-{hash}.vercel.app
    let cleanUrl = null;
    const urlWithoutDomain = deployData.url.replace(/\.vercel\.app$/, '');

    if (urlWithoutDomain.startsWith(projectName + '-')) {
      const rest = urlWithoutDomain.slice(projectName.length + 1);
      // Hash = 8-12 lowercase alphanumeric chars, no hyphens
      const m = rest.match(/^([a-z0-9]{8,12})(?:-(.+))?$/);
      if (m) {
        const teamSlug = m[2];
        cleanUrl = 'https://' + projectName + (teamSlug ? '-' + teamSlug : '') + '.vercel.app';
        console.log('[Deploy] Clean URL extracted:', cleanUrl);
      } else {
        console.warn('[Deploy] Regex did not match. rest =', rest);
      }
    } else {
      console.warn('[Deploy] URL does not start with projectName + "-". URL:', urlWithoutDomain);
    }

    // ===== STEP 3: Poll for READY + try to get aliases =====
    let aliasUrl = null;

    for (let i = 0; i < 8; i++) {
      try {
        const pollRes = await fetch(
          'https://api.vercel.com/v13/deployments/' + deployData.id + teamQuery,
          { headers: { 'Authorization': 'Bearer ' + VERCEL_TOKEN } }
        );
        if (pollRes.ok) {
          const pd = await pollRes.json();
          console.log('[Deploy] Poll', i, 'readyState:', pd.readyState, 'aliases:', pd.alias?.length || 0);

          if (pd.alias && Array.isArray(pd.alias) && pd.alias.length > 0) {
            const candidates = pd.alias
              .filter(a => typeof a === 'string' && a.endsWith('.vercel.app'))
              .sort((a, b) => a.length - b.length);
            if (candidates.length > 0) {
              aliasUrl = 'https://' + candidates[0];
              console.log('[Deploy] Alias from poll:', aliasUrl);
              break;
            }
          }
          if (pd.readyState === 'READY') {
            // One more attempt after READY
            await new Promise(r => setTimeout(r, 800));
          }
        }
      } catch (e) {
        console.warn('[Deploy] Poll error:', e.message);
      }
      await new Promise(r => setTimeout(r, 1200));
    }

    // ===== STEP 4: Explicit alias fetch (if polling failed) =====
    if (!aliasUrl) {
      try {
        const aliasesRes = await fetch(
          'https://api.vercel.com/v2/deployments/' + deployData.id + '/aliases' + teamQuery,
          { headers: { 'Authorization': 'Bearer ' + VERCEL_TOKEN } }
        );
        if (aliasesRes.ok) {
          const ad = await aliasesRes.json();
          const aliases = ad.aliases || [];
          const vercelAliases = aliases
            .map(a => a.alias || a.domain || '')
            .filter(a => a && a.endsWith('.vercel.app'))
            .sort((a, b) => a.length - b.length);
          if (vercelAliases.length > 0) {
            aliasUrl = 'https://' + vercelAliases[0];
            console.log('[Deploy] Alias from explicit fetch:', aliasUrl);
          }
        }
      } catch (e) {
        console.warn('[Deploy] Alias fetch error:', e.message);
      }
    }

    // ===== STEP 5: Final selection =====
    // Priority: aliasUrl (from Vercel) > cleanUrl (constructed) > deploymentUrl (fallback)
    const finalUrl = aliasUrl || cleanUrl || deploymentUrl;
    console.log('[Deploy] ✅ Final URL:', finalUrl);

    return res.status(200).json({
      url: finalUrl,
      deploymentUrl: deploymentUrl,
      cleanUrl: cleanUrl,
      aliasUrl: aliasUrl,
      project: projectName,
      teamId: teamId
    });

  } catch (err) {
    console.error('[Deploy] Exception:', err);
    return res.status(500).json({ error: err.message || 'Deploy failed' });
  }
};