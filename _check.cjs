const http = require('http');
http.get('http://localhost:5176/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Headers:', JSON.stringify(res.headers));
    console.log('Body start:', data.slice(0, 200));
    process.exit(0);
  });
}).on('error', (e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
