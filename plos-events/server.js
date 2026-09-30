import http from 'node:http';

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(410, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate'
  });
  res.end('PERSONAL LIFE OS Events: public web access disabled.');
});

server.listen(PORT, () => {
  console.log(`PLOS Events public service disabled on port ${PORT}`);
});
