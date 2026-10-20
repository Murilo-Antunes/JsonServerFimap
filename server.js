const path = require('path');
const jsonServer = require('json-server');

const server = jsonServer.create();
server.set('trust proxy', 1); // Necessário para o Render identificar o IP real do cliente

// Configura o router apontando para o seu db.json
const router = jsonServer.router(path.join(__dirname, 'db.json'));

// Middlewares padrão (CORS, logger, static)
const middlewares = jsonServer.defaults();

server.use(middlewares);
server.use(jsonServer.bodyParser);

// Se você quiser adicionar rotas customizadas ou validações no futuro, pode fazer aqui.

// Usa o router padrão do json-server para todas as tabelas do seu db.json
server.use(router);

const port = process.env.PORT || 3000;
server.listen(port, () => {
    console.log(`JSON Server rodando na porta http://localhost:${port}`);
});