const jsonServer = require('json-server');

const server = jsonServer.create();
server.set('trust proxy', 1); // atrás do proxy do Render: req.ip passa a ser o IP real do cliente

server.use(jsonServer.defaults()); // CORS, logger, static
server.use(jsonServer.bodyParser);

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`API em http://localhost:${port}`));
