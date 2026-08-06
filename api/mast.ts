import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const uri = req.query.uri as string;
  if (!uri) return res.status(400).send('Missing uri');

  const url = `https://mast.stsci.edu/api/v0.1/Download/file?uri=${encodeURIComponent(uri)}`;
  
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(upstream.status).send(upstream.statusText);
    
    const buffer = await upstream.arrayBuffer();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).send('Proxy error');
  }
}
