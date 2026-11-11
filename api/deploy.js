// api/deploy.js
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

    // Return the live URL
    const url = 'https://' + (data.alias?.[0] || data.url);
    return res.status(200).json({ url });
  } catch (err) {
    console.error('Deploy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
