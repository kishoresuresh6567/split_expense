const fs = require('node:fs');
const path = require('node:path');
const {buildSync} = require('esbuild');
const root = path.join(__dirname, '..');
const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_PUBLISHABLE_KEY || '';
if (process.env.VERCEL && (!url || !key)) throw Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Vercel before building.');
if (url && new URL(url).protocol !== 'https:') throw Error('SUPABASE_URL must use HTTPS.');
if (key && !key.startsWith('sb_publishable_')) {
  let role;
  try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role; } catch {}
  if (role !== 'anon') throw Error('Use a publishable or legacy anon key, never a secret/service-role key.');
}
fs.cpSync(path.join(root, 'public'), path.join(root, 'dist'), {recursive: true});
buildSync({entryPoints:[path.join(root, 'src/cloud.js')], outfile:path.join(root, 'dist/js/cloud.js'), bundle:true, minify:true, platform:'browser', target:'es2022', define:{SUPABASE_URL:JSON.stringify(url), SUPABASE_KEY:JSON.stringify(key)}});
