const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const contentTypes = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const server = http.createServer((req,res)=>{
  const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(root, relative);
  if (!filePath.startsWith(root + path.sep) && filePath !== path.join(root,'index.html')) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath,(error,data)=>{
    if(error){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Not found');}
    res.writeHead(200,{'Content-Type':contentTypes[path.extname(filePath)]||'application/octet-stream','Cache-Control':'no-cache'});
    res.end(data);
  });
});
const port = Number(process.env.PORT || 3000);
server.listen(port,'0.0.0.0',()=>console.log(`PostPilot demo listening on ${port}`));
