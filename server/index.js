const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const publicDirectory = path.join(__dirname, '..', 'public');
const files = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/assets/gather-logo.svg': 'assets/gather-logo.svg',
  '/css/styles.css': 'css/styles.css',
  '/js/app.js': 'js/app.js',
  '/js/expense-logic.js': 'js/expense-logic.js',
  '/js/views.js': 'js/views.js',
  '/js/forms.js': 'js/forms.js'
};
const server = http.createServer((req,res) => {
  const file = files[req.url.split('?')[0]];
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', {'html':'text/html; charset=utf-8','css':'text/css','js':'text/javascript','svg':'image/svg+xml'}[path.extname(file).slice(1)]);
  const stream = fs.createReadStream(path.join(publicDirectory,file));
  stream.on('error',()=>{res.statusCode=500;res.end('Unable to load file');});
  stream.pipe(res);
});
let port = Number(process.env.PORT || 3000), retries = 0;
server.on('error',error=>{
  if(error.code==='EADDRINUSE' && retries++<20 && port<65535){console.log(`Port ${port} is busy. Trying ${port+1}...`);server.listen(++port);}
  else {console.error(error.message);process.exit(1);}
});
server.on('listening',()=>console.log(`Gather is ready at http://localhost:${server.address().port}`));
server.listen(port);
