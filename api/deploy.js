// api/deploy.js — Sajeel Hosting ULTIMATE (Auto-clean URL + No Login)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const { html, name } = req.body || {};
  if (!html || !name) return res.status(400).json({ error: 'Missing html or name' });

  const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
  if (!VERCEL_TOKEN) return res.status(500).json({ error: 'VERCEL_TOKEN missing' });

  // 1. Sanitize project name
  const slug = String(name).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'portfolio';
  const projectName = 'portfolio-' + slug;
  
  const headers = {
    'Authorization': 'Bearer ' + VERCEL_TOKEN,
    'Content-Type': 'application/json',
  };

  try {
    // 2. Deploy the HTML
    const deployRes = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: projectName,
        files: [{ file: 'index.html', data: Buffer.from(html, 'utf-8').toString('base64'), encoding: 'base64' }],
        projectSettings: { framework: null, buildCommand: null, outputDirectory: null, installCommand: null },
        target: 'production'
      })
    });

    const deployData = await deployRes.json();
    if (!deployRes.ok) throw new Error(deployData.error?.message || 'Deployment failed');

    const teamId = deployData.teamId;
    const teamQuery = teamId ? '?teamId=' + teamId : '';

    // 3. Disable Vercel Login Protection (SSO)
    try {
      await fetch('https://api.vercel.com/v9/projects/' + projectName + teamQuery, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ ssoProtection: null, passwordProtection: null })
      });
    } catch (e) { console.warn('SSO disable failed', e); }

    // 4. Assign a CLEAN Domain to the project
    // This removes the hash (e.g., portfolio-ali-raza.vercel.app)
    let cleanDomain = projectName + '.vercel.app';
    try {
      const domainRes = await fetch(`https://api.vercel.com/v10/projects/${projectName}/domains${teamQuery}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: cleanDomain })
      });
      const domainData = await domainRes.json();
      
      // Agar domain kisi aur ne le rakha hai, to team-slug ke sath fallback use karein
      if (!domainRes.ok && domainData.error?.code === 'domain_already_in_use') {
        // Extract team slug from raw URL
        const match = deployData.url.match(/-([a-z0-9]+-[a-z0-9-]+)\.vercel\.app$/);
        if (match) cleanDomain = `${projectName}-${match[1]}.vercel.app`;
      }
    } catch (e) { console.warn('Domain assign failed', e); }

    // 5. Return Final Clean URL
    return res.status(200).json({ url: 'https://' + cleanDomain });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};