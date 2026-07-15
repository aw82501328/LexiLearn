// fix-server-import.cjs - copy server.js to deploy-package with fixed import path
var fs = require('fs');
var c = fs.readFileSync('server.js', 'utf-8');
c = c.replace('./src/services/adminServer.js', './adminServer.js');
fs.writeFileSync('deploy-package/server.js', c, 'utf-8');
console.log('server.js patched and copied to deploy-package');
